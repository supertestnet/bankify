// dependencies:
// https://bundle.run/noble-secp256k1@1.2.14
// https://bundle.run/browserify-cipher@1.0.1
var super_nostr = {
    hexToBytes: hex => Uint8Array.from( hex.match( /.{1,2}/g ).map( byte => parseInt( byte, 16 ) ) ),
    bytesToHex: bytes => bytes.reduce( ( str, byte ) => str + byte.toString( 16 ).padStart( 2, "0" ), "" ),
    base64ToHex: str => {
        var raw = atob( str );
        var result = '';
        var i; for ( i=0; i<raw.length; i++ ) {
            var hex = raw.charCodeAt( i ).toString( 16 );
            result += hex.length % 2 ? '0' + hex : hex;
        }
        return result.toLowerCase();
    },
    getPrivkey: () => super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ),
    getPubkey: privkey => nobleSecp256k1.getPublicKey( privkey, true ).substring( 2 ),
    sha256: async text_or_bytes => {if ( typeof text_or_bytes === "string" ) text_or_bytes = ( new TextEncoder().encode( text_or_bytes ) );return super_nostr.bytesToHex( await nobleSecp256k1.utils.sha256( text_or_bytes ) )},
    waitSomeSeconds: num => {
        var num = num.toString() + "000";
        num = Number( num );
        return new Promise( resolve => setTimeout( resolve, num ) );
    },
    getEvents: async ( relay_or_socket, ids, authors, kinds, until, since, limit, etags, ptags ) => {
        var socket_is_permanent = false;
        if ( typeof socket !== "string" ) socket_is_permanent = true;
        if ( typeof socket === "string" ) var socket = new WebSocket( relay_or_socket );
        else var socket = relay_or_socket;
        var events = [];
        var opened = false;
        if ( socket_is_permanent ) {
            var subId = super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 16 );
            var filter  = {}
            if ( ids ) filter.ids = ids;
            if ( authors ) filter.authors = authors;
            if ( kinds ) filter.kinds = kinds;
            if ( until ) filter.until = until;
            if ( since ) filter.since = since;
            if ( limit ) filter.limit = limit;
            if ( etags ) filter[ "#e" ] = etags;
            if ( ptags ) filter[ "#p" ] = ptags;
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
            return;
        }
        socket.addEventListener( 'message', async function( message ) {
            var [ type, subId, event ] = JSON.parse( message.data );
            var { kind, content } = event || {}
            if ( !event || event === true ) return;
            events.push( event );
        });
        socket.addEventListener( 'open', async function( e ) {
            opened = true;
            var subId = super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 16 );
            var filter  = {}
            if ( ids ) filter.ids = ids;
            if ( authors ) filter.authors = authors;
            if ( kinds ) filter.kinds = kinds;
            if ( until ) filter.until = until;
            if ( since ) filter.since = since;
            if ( limit ) filter.limit = limit;
            if ( etags ) filter[ "#e" ] = etags;
            if ( ptags ) filter[ "#p" ] = ptags;
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
        });
        var loop = async () => {
            if ( !opened ) {
                await super_nostr.waitSomeSeconds( 1 );
                return await loop();
            }
            var len = events.length;
            await super_nostr.waitSomeSeconds( 1 );
            if ( len !== events.length ) return await loop();
            socket.close();
            return events;
        }
        return await loop();
    },
    prepEvent: async ( privkey, msg, kind, tags ) => {
        pubkey = super_nostr.getPubkey( privkey );
        if ( !tags ) tags = [];
        var event = {
            "content": msg,
            "created_at": Math.floor( Date.now() / 1000 ),
            "kind": kind,
            "tags": tags,
            "pubkey": pubkey,
        }
        var signedEvent = await super_nostr.getSignedEvent( event, privkey );
        return signedEvent;
    },
    sendEvent: ( event, relay_or_socket ) => {
        var socket_is_permanent = false;
        if ( typeof socket !== "string" ) socket_is_permanent = true;
        if ( typeof socket === "string" ) var socket = new WebSocket( relay_or_socket );
        else var socket = relay_or_socket;
        if ( !socket_is_permanent ) {
            socket.addEventListener( 'open', async () => {
                socket.send( JSON.stringify( [ "EVENT", event ] ) );
                setTimeout( () => {socket.close();}, 1000 );
            });
        } else {
            socket.send( JSON.stringify( [ "EVENT", event ] ) );
        }
        return event.id;
    },
    getSignedEvent: async ( event, privkey ) => {
        var eventData = JSON.stringify([
            0,
            event['pubkey'],
            event['created_at'],
            event['kind'],
            event['tags'],
            event['content'],
        ]);
        event.id = await super_nostr.sha256( eventData );
        event.sig = await nobleSecp256k1.schnorr.sign( event.id, privkey );
        return event;
    },
    encrypt: ( privkey, pubkey, text ) => {
        var key = nobleSecp256k1.getSharedSecret( privkey, '02' + pubkey, true ).substring( 2 );
        var iv = window.crypto.getRandomValues( new Uint8Array( 16 ) );
        var cipher = browserifyCipher.createCipheriv( 'aes-256-cbc', super_nostr.hexToBytes( key ), iv );
        var encryptedMessage = cipher.update(text,"utf8","base64");
        emsg = encryptedMessage + cipher.final( "base64" );
        var uint8View = new Uint8Array( iv.buffer );
        var decoder = new TextDecoder();
        return emsg + "?iv=" + btoa( String.fromCharCode.apply( null, uint8View ) );
    },
    decrypt: ( privkey, pubkey, ciphertext ) => {
        var [ emsg, iv ] = ciphertext.split( "?iv=" );
        var key = nobleSecp256k1.getSharedSecret( privkey, '02' + pubkey, true ).substring( 2 );
        var decipher = browserifyCipher.createDecipheriv(
            'aes-256-cbc',
            super_nostr.hexToBytes( key ),
            super_nostr.hexToBytes( super_nostr.base64ToHex( iv ) )
        );
        var decryptedMessage = decipher.update( emsg, "base64" );
        dmsg = decryptedMessage + decipher.final( "utf8" );
        return dmsg;
    },
}
