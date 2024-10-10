// dependencies:
// npm i bolt11 @gandlaf21/blind-signature ws browserify-cipher noble-secp256k1
var bolt11 = require( 'bolt11' );
var crypto = require( 'crypto' );
var nobleSecp256k1 = require( 'noble-secp256k1' );
var SigningAuthority = require( '@gandlaf21/blind-signature' ).SigningAuthority;
var BlindedMessage = require( '@gandlaf21/blind-signature' ).BlindedMessage;
var blindSigJS = {
    getRand: t => crypto.getRandomValues(new Uint8Array(t)),
    ecPointToHex: t => t.toHex(),
    bsjMint: SigningAuthority,
    bsjMsg: BlindedMessage,
}
var WebSocket = require( 'ws' ).WebSocket;
var browserifyCipher = require( 'browserify-cipher' );
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
        if ( typeof relay_or_socket !== "string" ) socket_is_permanent = true;
        if ( typeof relay_or_socket === "string" ) var socket = new WebSocket( relay_or_socket );
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
        if ( typeof relay_or_socket !== "string" ) socket_is_permanent = true;
        if ( typeof relay_or_socket === "string" ) var socket = new WebSocket( relay_or_socket );
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
        var iv = crypto.getRandomValues( new Uint8Array( 16 ) );
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
var bankify = {
    state: {
        utxos: [],
        nostr_state: {
            sockets: {},
            nwc_info: {}
        },
    },
    isValidHex: hex => {
        if ( !hex ) return;
        var length = hex.length;
        if ( length % 2 ) return;
        try {
            var bigint = BigInt( "0x" + hex, "hex" );
        } catch( e ) {
            return;
        }
        var prepad = bigint.toString( 16 );
        var i; for ( i=0; i<length; i++ ) prepad = "0" + prepad;
        var padding = prepad.slice( -Math.abs( length ) );
        return ( padding === hex );
    },
    hexToBytes: hex => Uint8Array.from( hex.match( /.{1,2}/g ).map( byte => parseInt( byte, 16 ) ) ),
    bytesToHex: bytes => bytes.reduce( ( str, byte ) => str + byte.toString( 16 ).padStart( 2, "0" ), "" ),
    textToHex: text => {
        var encoded = new TextEncoder().encode( text );
        return Array.from( encoded )
            .map( x => x.toString( 16 ).padStart( 2, "0" ) )
            .join( "" );
    },
    waitASec: num => new Promise( res => setTimeout( res, num * 1000 ) ),
    decomposeAmount: amount_to_decompose => {
        var decomposed = [];
        var getBaseLog = ( x, y ) => Math.log(y) / Math.log(x);
        var inner_fn = amt => {
            var exponent = Math.floor( getBaseLog( 2, amt ) );
            decomposed.push( 2 ** exponent );
            amount_to_decompose = amt - 2 ** exponent;
            if ( amount_to_decompose ) inner_fn(amount_to_decompose);
        }
        inner_fn( amount_to_decompose );
        return decomposed;
    },
    getUtxosAndSecrets: async ( amounts_to_get, keyset, make_blank, full_utxos ) => {
        var num_of_iterations = amounts_to_get.length;
        if ( make_blank ) num_of_iterations = amounts_to_get;
        var outputs = [];
        var secrets = [];
        var i; for ( i=0; i<num_of_iterations; i++ ) {
            if ( !make_blank && !full_utxos ) {
                var item = amounts_to_get[ i ];
                var amount = item;
            } else if ( !make_blank && full_utxos ) {
                var item = amounts_to_get[ i ];
                var amount = item[ "amount" ];
                var keyset = item[ "id" ];
            } else {
                var amount = 1;
            }
            var secret_for_msg = bankify.bytesToHex(blindSigJS.getRand(32));
            var message = new blindSigJS.bsjMsg();
            var B_ = await message.createBlindedMessageFromString( secret_for_msg );
            var B_hex = blindSigJS.ecPointToHex( B_ );
            outputs.push({
                amount,
                id: keyset,
                "B_": B_hex,
            });
            secrets.push( [ secret_for_msg, message ] );
        }
        return [ outputs, secrets ];
    },
    processSigs: ( sigs, secrets, pubkeys ) => {
        var utxos_to_return = [];
        var i; for ( i=0; i<sigs.length; i++ ) {
            var sig_data = sigs[ i ];
            var id = sig_data[ "id" ];
            var amount = sig_data[ "amount" ];
            var secret = secrets[ i ][ 0 ];
            var blinded_sig = sig_data[ "C_" ];
            var message = secrets[ i ][ 1 ];
            var C_ = nobleSecp256k1.Point.fromCompressedHex( bankify.hexToBytes( blinded_sig ) );
            var amt_pubkey = pubkeys[ amount ];
            amt_pubkey = nobleSecp256k1.Point.fromCompressedHex( bankify.hexToBytes( amt_pubkey ) );
            var {C} = message.unblindSignature(C_, amt_pubkey);
            var compressed_C = nobleSecp256k1.Point.fromHex( blindSigJS.ecPointToHex( C ) ).toHex( true );
            var utxo = {
                id,
                amount,
                secret,
                C: compressed_C,
            }
            utxos_to_return.push( utxo );
        }
        return utxos_to_return;
    },
    getBalance: () => {
        var bal = 0;
        bankify.state.utxos.forEach( item => bal = bal + item[ "amount" ] );
        return bal;
    },
    getBlockheight: async () => {
        var data = await fetch( `https://mempool.space/api/blocks/tip/height` );
        return Number( await data.text() );
    },
    getBlockhash: async blocknum => {
        var data = await fetch( `https://mempool.space/api/block-height/${blocknum}` );
        return data.text();
    },
    getInvoicePmthash: invoice => {
        var decoded = bolt11.decode( invoice );
        var i; for ( i=0; i<decoded[ "tags" ].length; i++ ) {
            if ( decoded[ "tags" ][ i ][ "tagName" ] == "payment_hash" ) var pmthash = decoded[ "tags" ][ i ][ "data" ].toString();
        }
        return pmthash;
    },
    getInvoiceDescription: invoice => {
        var description = "";
        var decoded = bolt11.decode( invoice );
        var i; for ( i=0; i<decoded[ "tags" ].length; i++ ) {
            if ( decoded[ "tags" ][ i ][ "tagName" ] == "description" ) description = decoded[ "tags" ][ i ][ "data" ].toString();
        }
        return description;
    },
    getInvoiceDeschash: invoice => {
        var deschash = "";
        var decoded = bolt11.decode( invoice );
        var i; for ( i=0; i<decoded[ "tags" ].length; i++ ) {
            if ( decoded[ "tags" ][ i ][ "tagName" ] == "purpose_commit_hash" ) var deschash = decoded[ "tags" ][ i ][ "data" ].toString();
        }
        return deschash;
    },
    checkInvoiceTilPaidOrError: async ( mymint, invoice_data, app_pubkey ) => {
        var is_paid = await bankify.checkLNInvoice( mymint, invoice_data, app_pubkey );
        if ( is_paid ) return;
        var pmthash = bankify.getInvoicePmthash( invoice_data[ "request" ] );
        var expiry = bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "expires_at" ];
        var now = Math.floor( Date.now() / 1000 );
        if ( now >= expiry ) return;
        await super_nostr.waitSomeSeconds( 20 );
        bankify.checkInvoiceTilPaidOrError( mymint, invoice_data, app_pubkey );
    },
    getLNInvoice: async ( mymint, full_amount ) => {
        var amounts_to_get = bankify.decomposeAmount( full_amount );
        amounts_to_get.sort();
        var post_data = {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({"amount": full_amount, "unit": "sat"}),
        }
        var invoice_data = await fetch( `${mymint}/v1/mint/quote/bolt11`, post_data );
        invoice_data = await invoice_data.json();
        return invoice_data;
    },
    checkLNInvoice: async ( mymint, invoice_data, app_pubkey ) => {
        if ( typeof invoice_data !== "object" ) {
            //I normally pass in an invoice_data object which I got
            //from the mint. But when this is an invoice *I* am
            //paying, the mint doesn't have any info about this
            //invoice, so instead, I do this: I pass an actual
            //"invoice" to this function -- which detect that it is
            //not an object, and thus it is not the kind of thing
            //the mint knows about -- and I simply check if my
            //tx_history has a settled_at value. If so, it is
            //settled and I don't need to ask the mint.
            var pmthash = bankify.getInvoicePmthash( invoice_data );
            return !!bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ].settled_at;
        }
        var pmthash = bankify.getInvoicePmthash( invoice_data[ "request" ] );
        var url = `${mymint}/v1/mint/quote/bolt11/${invoice_data[ "quote" ]}`;
        var settled_status = bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "settled_at" ];
        var is_paid_info = await fetch( url );
        is_paid_info = await is_paid_info.json();
        var is_paid = is_paid_info[ "paid" ];
        if ( is_paid ) bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "paid" ] = true;
        var status_changed = is_paid && !settled_status;
        if ( status_changed ) bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "settled_at" ] = Math.floor( Date.now() / 1000 );
        if ( status_changed ) bankify.state.nostr_state.nwc_info[ app_pubkey ].balance = bankify.state.nostr_state.nwc_info[ app_pubkey ].balance + bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "amount" ];
        if ( status_changed ) bankify.getSigsAfterLNInvoiceIsPaid( mymint, invoice_data );
        return is_paid;
    },
    getSigsAfterLNInvoiceIsPaid: async ( mymint, invoice_data ) => {
        var pre_amount = bolt11.decode( invoice_data[ "request" ] ).satoshis;
        var amounts_to_get = bankify.decomposeAmount( pre_amount );
        var keysets = await fetch( `${mymint}/v1/keysets` );
        keysets = await keysets.json();
        keysets = keysets[ "keysets" ];
        var keyset = null;
        keysets.every( item => {if ( bankify.isValidHex( item.id ) && item.active ) {keyset = item.id;return;} return true;});
        var pubkeys = await fetch(`${mymint}/v1/keys/${keyset}`);
        pubkeys = await pubkeys.json();
        pubkeys = pubkeys[ "keysets" ][ 0 ][ "keys" ];
        var [ outputs, secrets ] = await bankify.getUtxosAndSecrets( amounts_to_get, keyset );
        var sig_request = {"quote": invoice_data[ "quote" ], outputs}
        var post_data = {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(sig_request),
        }
        var blinded_sigs = await fetch( `${mymint}/v1/mint/bolt11`, post_data );
        blinded_sigs = await blinded_sigs.json();
        var new_utxos = bankify.processSigs( blinded_sigs[ "signatures" ], secrets, pubkeys );
        bankify.state.utxos.push( ...new_utxos );
    },
    send: async ( mymint, invoice_or_amount, amnt_for_amountless_invoice, app_pubkey ) => {
        if ( !invoice_or_amount ) return;
        if ( isNaN( invoice_or_amount ) ) {
            var pre_amount = bolt11.decode( invoice_or_amount ).satoshis;
            var post_data = {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({request: invoice_or_amount, unit: "sat"}),
            }
            var quote_info = await fetch( `${mymint}/v1/melt/quote/bolt11`, post_data );
            quote_info = await quote_info.json();
            var quote_id = quote_info[ "quote" ];
            var amount = quote_info[ "amount" ] + quote_info[ "fee_reserve" ];
        } else {
            var amount = Number( invoice_or_amount );
        }
        var err_msg = `you cannot send more than you have`;
        if ( isNaN( invoice_or_amount ) ) err_msg = `you cannot send this amount because you need an extra ${amount - bankify.getBalance()} sats to pay for potential LN routing fees. Try sending a bit less`;
        if ( isNaN( amount ) || Number( amount ) < 1 || amount > bankify.getBalance() ) {
            if ( app_pubkey ) {
                if ( isNaN( invoice_or_amount ) ) {
                    var pmthash = bankify.getInvoicePmthash( invoice_or_amount );
                    bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "err_msg" ] = err_msg;
                }
                return err_msg;
            }
            return console.log( err_msg );
        }
        var change = bankify.getBalance() - amount;
        var change_decomposed = bankify.decomposeAmount( change );
        if ( change_decomposed.length === 1 && change_decomposed[ 0 ] === 0 ) change_decomposed = [];
        var send_amnt_decomposed = bankify.decomposeAmount( amount );
        var keyset = bankify.state.utxos[ 0 ][ "id" ];
        var [ potential_change_outputs, change_secrets ] = await bankify.getUtxosAndSecrets( change_decomposed, keyset );
        var [ potential_send_outputs, send_secrets ] = await bankify.getUtxosAndSecrets( send_amnt_decomposed, keyset );
        var balance_before_paying = bankify.getBalance();
        if ( potential_change_outputs.length ) {
            var swap_data = {
                "inputs": bankify.state.utxos,
                "outputs": [ ...potential_change_outputs, ...potential_send_outputs ],
            }
            //TODO: ensure all your utxos use the same mint before this part
            var post_data = {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify( swap_data ),
            }
            var blinded_sigs = await fetch( `${mymint}/v1/swap`, post_data );
            blinded_sigs = await blinded_sigs.json();
            var change_blinded_sigs = [];
            var send_blinded_sigs = [];
            blinded_sigs[ "signatures" ].forEach( ( sig, index ) => {
                if ( index < potential_change_outputs.length ) change_blinded_sigs.push( sig );
                else send_blinded_sigs.push( sig );
            });
            var pubkeys = await fetch(`${mymint}/v1/keys/${keyset}`);
            pubkeys = await pubkeys.json();
            pubkeys = pubkeys[ "keysets" ][ 0 ][ "keys" ];
            var real_change_utxos = bankify.processSigs( change_blinded_sigs, change_secrets, pubkeys );
            bankify.state.utxos.push( ...real_change_utxos );
            var real_send_utxos = bankify.processSigs( send_blinded_sigs, send_secrets, pubkeys );
            bankify.state.utxos = real_change_utxos;
        } else {
            var real_send_utxos = bankify.state.utxos;
            bankify.state.utxos = [];
        }
        if ( isNaN( invoice_or_amount ) ) {
            if ( quote_info[ "fee_reserve" ] ) var [ potential_outputs, secrets ] = await bankify.getUtxosAndSecrets( change_decomposed, keyset, true );
            else var potential_outputs = [];
            var pay_data = {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({quote: quote_id, inputs: real_send_utxos, outputs: potential_outputs}),
            }
            if ( app_pubkey ) {
                var state_balance = bankify.state.nostr_state.nwc_info[ app_pubkey ].balance;
                bankify.state.nostr_state.nwc_info[ app_pubkey ].balance = state_balance - ( pre_amount * 1000 );
            }
            var pay_info = await fetch( `${mymint}/v1/melt/bolt11`, pay_data );
            pay_info = await pay_info.json();
            var response = null;
            if ( app_pubkey ) var state_balance = bankify.state.nostr_state.nwc_info[ app_pubkey ].balance;
            else var state_balance = "no app pubkey";
            if ( pay_info[ "paid" ] ) {
                if ( "change" in pay_info && pay_info[ "change" ].length ) {
                    var pubkeys = await fetch( `${mymint}/v1/keys/${keyset}` );
                    pubkeys = await pubkeys.json();
                    pubkeys = pubkeys[ "keysets" ][ 0 ][ "keys" ];
                    var change_utxos = bankify.processSigs( pay_info[ "change" ], secrets, pubkeys );
                    bankify.state.utxos.push( ...change_utxos );
                }
                if ( app_pubkey ) {
                    var pmthash = bankify.getInvoicePmthash( invoice_or_amount );
                    bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "preimage" ] = pay_info[ "payment_preimage" ];
                    bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "settled_at" ] = Math.floor( Date.now() / 1000 );
                    bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "paid" ] = true;
                    var balance_now = bankify.getBalance();
                    var fees_paid = ( balance_before_paying - pre_amount - balance_now ) * 1000;
                    bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ].fees_paid = fees_paid;
                    bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ].description = bankify.getInvoiceDescription( bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "invoice" ] );
                    var state_balance = bankify.state.nostr_state.nwc_info[ app_pubkey ].balance;
                    bankify.state.nostr_state.nwc_info[ app_pubkey ].balance = state_balance - fees_paid;
                }
                console.log( "preimage:" );
                console.log( pay_info[ "payment_preimage" ] );
                response = `payment succeeded -- the preimage is in your browser console`;
            } else {
                response = `payment failed`;
                bankify.state.utxos.push( ...real_send_utxos );
                if ( app_pubkey ) {
                    var state_balance = bankify.state.nostr_state.nwc_info[ app_pubkey ].balance;
                    bankify.state.nostr_state.nwc_info[ app_pubkey ].balance = state_balance + ( pre_amount * 1000 );
                }
            }
            if ( app_pubkey ) return response;
            return console.log( response );
        }
        var nut = {
            mint: mymint,
            proofs: real_send_utxos,
        }
        nut = "cashuA" + btoa( JSON.stringify( {token: [nut]} ) );
        console.log( nut );
    },
    createNWCconnection: async ( mymint, permissions = [ "pay_invoice", "get_balance", "make_invoice", "lookup_invoice", "list_transactions", "get_info" ], myrelay = "wss://nostrue.com", app_pubkey ) => {
        var listen = async ( socket, app_pubkey ) => {
            var subId = super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() ).substring( 0, 16 );
            var filter  = {}
            filter.kinds = [ 23194 ];
            filter.since = Math.floor( Date.now() / 1000 );
            filter[ "#p" ] = [ app_pubkey ];
            var subscription = [ "REQ", subId, filter ];
            socket.send( JSON.stringify( subscription ) );
            var state = bankify.state.nostr_state.nwc_info[ app_pubkey ];
            var msg = permissions.join( " " );
            var event = await super_nostr.prepEvent( state[ "app_privkey" ], msg, 13194 );
            return super_nostr.sendEvent( event, socket );
        }
        var handleEvent = async message => {
            var [ type, subId, event ] = JSON.parse( message.data );
            var { kind, content } = event || {}
            if ( !event || event === true ) return;
            var app_pubkey = getRecipientFromNostrEvent( event );
            if ( !( app_pubkey in bankify.state.nostr_state.nwc_info ) ) return;
            var state = bankify.state.nostr_state.nwc_info[ app_pubkey ];
            if ( event.pubkey !== state[ "user_pubkey" ] ) return;
            //validate sig
            var serial_event = JSON.stringify([
                0,
                event['pubkey'],
                event['created_at'],
                event['kind'],
                event['tags'],
                event['content']
            ]);
            var id_bytes = await nobleSecp256k1.utils.sha256( bankify.hexToBytes( bankify.textToHex( serial_event ) ) );
            var id = bankify.bytesToHex( id_bytes );
            var sig = event.sig;
            var pubkey = event.pubkey;
            var sig_is_valid = await nobleSecp256k1.schnorr.verify( sig, id, pubkey );
            if ( !sig_is_valid ) return;
            var command = super_nostr.decrypt( state[ "app_privkey" ], event.pubkey, content );
            var mymint = state.mymint;
            try {
                command = JSON.parse( command );
                console.log( command );
                if ( !state.permissions.includes( command.method ) ) {
                    var reply = JSON.stringify({
                        result_type: command.method,
                        error: {
                            code: "RESTRICTED",
                            message: "This public key is not allowed to do this operation.",
                        },
                        result: {}
                    });
                    var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                    return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                }
                if ( command.method === "get_info" ) {
                    var blockheight = await bankify.getBlockheight();
                    var blockhash = await bankify.getBlockhash( blockheight );
                    var reply = JSON.stringify({
                        result_type: command.method,
                        result: {
                            alias: "",
                            color: "",
                            pubkey: "",
                            network: "mainnet",
                            block_height: blockheight,
                            block_hash: blockhash,
                            methods: state.permissions,
                        },
                    });
                    var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                    return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                }
                if ( command.method === "get_balance" ) {
                    var reply = JSON.stringify({
                        result_type: command.method,
                        result: {
                            balance: bankify.state.nostr_state.nwc_info[ app_pubkey ].balance,
                        },
                    });
                    var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                    return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                }
                if ( command.method === "make_invoice" ) {
                    if ( !String( command.params.amount ).endsWith( "000" ) ) {
                        var reply = JSON.stringify({
                            result_type: command.method,
                            error: {
                                code: "OTHER",
                                message: "amount must end in 000 (remember, we require millisats! But they must always be zero!)",
                            },
                            result: {}
                        });
                        var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                        return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                    }
                    var invoice_data = await bankify.getLNInvoice( mymint, Math.floor( command.params.amount / 1000 ) );
                    var reply = JSON.stringify({
                        result_type: command.method,
                        result: {
                            type: "incoming",
                            invoice: invoice_data.request,
                            bolt11: invoice_data.request,
                            description: command.params.description,
                            description_hash: "",
                            preimage: "",
                            payment_hash: bankify.getInvoicePmthash( invoice_data.request ),
                            amount: command.params.amount,
                            fees_paid: 0,
                            created_at: bolt11.decode( invoice_data.request ).timestamp,
                            expires_at: bolt11.decode( invoice_data.request ).timeExpireDate,
                            settled_at: null,
                        },
                    });
                    state.tx_history[ bankify.getInvoicePmthash( invoice_data[ "request" ] ) ] = {
                        invoice_data,
                        pmthash: bankify.getInvoicePmthash( invoice_data[ "request" ] ),
                        amount: command.params.amount,
                        invoice: invoice_data[ "request" ],
                        bolt11: invoice_data[ "request" ],
                        quote: invoice_data[ "quote" ],
                        type: "incoming",
                        description: command.params.description,
                        description_hash: "",
                        preimage: "",
                        payment_hash: bankify.getInvoicePmthash( invoice_data[ "request" ] ),
                        fees_paid: 0,
                        created_at: bolt11.decode( invoice_data.request ).timestamp,
                        expires_at: bolt11.decode( invoice_data.request ).timeExpireDate,
                        settled_at: null,
                        paid: false,
                    }
                    bankify.checkInvoiceTilPaidOrError( mymint, invoice_data, app_pubkey );
                    var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                    return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                }
                if ( command.method === "lookup_invoice" ) {
                    var invoice = null;
                    if ( "bolt11" in command.params ) invoice = command.params.bolt11;
                    if ( "invoice" in command.params && !invoice ) invoice = command.params.invoice;
                    if ( invoice ) var pmthash = bankify.getInvoicePmthash( invoice );
                    if ( "payment_hash" in command.params && !pmthash ) {
                        var pmthash = command.params.payment_hash;
                    }
                    if ( !pmthash || !( pmthash in state.tx_history ) ) {
                        var reply = JSON.stringify({
                            result_type: command.method,
                            error: {
                                code: "INTERNAL",
                                message: "invoice not found",
                            },
                            result: {}
                        });
                        var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                        return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                    }
                    if ( !invoice ) invoice = state.tx_history[ pmthash ].invoice;
                    var invoice_data = state.tx_history[ pmthash ][ "invoice_data" ];
                    if ( !invoice_data ) invoice_data = invoice;
                    var invoice_is_settled = await bankify.checkLNInvoice( mymint, invoice_data, app_pubkey );
                    var preimage_to_return = state.tx_history[ pmthash ][ "preimage" ];
                    var reply = {
                        result_type: "lookup_invoice",
                        result: {
                            type: state.tx_history[ pmthash ][ "type" ],
                            invoice: invoice,
                            bolt11: invoice,
                            description: state.tx_history[ pmthash ][ "description" ],
                            description_hash: state.tx_history[ pmthash ][ "description_hash" ],
                            preimage: preimage_to_return,
                            payment_hash: state.tx_history[ "payment_hash" ],
                            amount: state.tx_history[ pmthash ][ "amount" ],
                            fees_paid: state.tx_history[ pmthash ][ "fees_paid" ],
                            created_at: state.tx_history[ pmthash ][ "created_at" ],
                            expires_at: state.tx_history[ pmthash ][ "expires_at" ],
                            settled_at: state.tx_history[ pmthash ][ "settled_at" ],
                        }
                    }
                    if ( "err_msg" in state.tx_history[ pmthash ] && state.tx_history[ pmthash ][ "err_msg" ] ) {
                        reply.error = {
                            code: "OTHER",
                            message: state.tx_history[ pmthash ][ "err_msg" ],
                        }
                        reply.result = {}
                    }
                    reply = JSON.stringify( reply );
                    var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                    return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                }
                if ( command.method === "list_transactions" ) {
                    var txids = Object.keys( bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history );
                    var txs = [];
                    var include_unpaid = false;
                    var include_incoming = true;
                    var include_outgoing = true;
                    if ( "unpaid" in command.params && command.params[ "unpaid" ] ) include_unpaid = true;
                    if ( "type" in command.params && command.params[ "type" ] === "incoming" ) include_outgoing = false;
                    if ( "type" in command.params && command.params[ "type" ] === "outgoing" ) include_incoming = false;
                    txids.forEach( item => {
                        var tx = bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ item ];
                        if ( !include_unpaid && !tx[ "paid" ] ) return;
                        if ( !include_incoming && tx[ "type" ] === "incoming" ) return;
                        if ( !include_outgoing && tx[ "type" ] === "outgoing" ) return;
                        txs.push( tx );
                    });
                    txs = JSON.parse( JSON.stringify( txs ) );
                    txs.forEach( item => delete item[ "invoice_data" ] );
                    txs.sort( ( a, b ) => b[ "created_at" ] - a[ "created_at" ] );
                    if ( "from" in command.params ) {
                        var new_txs = [];
                        txs.forEach( item => {
                            if ( item.created_at < command.params[ "from" ] ) return;
                            new_txs.push( item );
                        });
                        txs = JSON.parse( JSON.stringify( new_txs ) );
                    }
                    if ( "until" in command.params ) {
                        var new_txs = [];
                        txs.forEach( item => {
                            if ( item.created_at > command.params[ "until" ] ) return;
                            new_txs.push( item );
                        });
                        txs = JSON.parse( JSON.stringify( new_txs ) );
                    }
                    if ( "offset" in command.params ) {
                        var new_txs = [];
                        txs.every( ( item, index ) => {
                            if ( index < command.params[ "offset" ] ) return true;
                            new_txs.push( item );
                        });
                        txs = JSON.parse( JSON.stringify( new_txs ) );
                        return true;
                    }
                    if ( "limit" in command.params ) {
                        var new_txs = [];
                        txs.every( item => {
                            if ( new_txs.length >= command.params[ "limit" ] ) return;
                            new_txs.push( item );
                            return true;
                        });
                        txs = JSON.parse( JSON.stringify( new_txs ) );
                    }
                    var reply = JSON.stringify({
                        result_type: command.method,
                        result: {
                            transactions: txs,
                        },
                    });
                    var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                    return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                }
                if ( command.method === "pay_invoice" ) {
                    var invoice = null;
                    if ( "bolt11" in command.params ) invoice = command.params.bolt11;
                    if ( "invoice" in command.params && !invoice ) invoice = command.params.invoice;
                    if ( invoice ) var pmthash = bankify.getInvoicePmthash( invoice );
                    else return;
                    var invoice_amt = bolt11.decode( invoice ).satoshis;

                    //put the tx info in tx_history

                    state.tx_history[ pmthash ] = {
                        type: "outgoing",
                        invoice: invoice,
                        bolt11: invoice,
                        description: bankify.getInvoiceDescription( invoice ),
                        description_hash: bankify.getInvoiceDeschash( invoice ),
                        preimage: "",
                        payment_hash: pmthash,
                        amount: Number( bolt11.decode( invoice ).millisatoshis ),
                        fees_paid: 0,
                        created_at: bolt11.decode( invoice ).timestamp,
                        expires_at: bolt11.decode( invoice ).timeExpireDate,
                        settled_at: null,
                        paid: false,
                    }

                    if ( !invoice_amt ) {
                        var err_msg = `amountless invoices are not yet supported by this backend`;
                        bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "err_msg" ] = err_msg;
                        var reply = JSON.stringify({
                            result_type: command.method,
                            error: {
                                code: "NOT_IMPLEMENTED",
                                message: `amountless invoices are not yet supported by this backend`,
                            },
                            result: {}
                        });
                        var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                        return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                    }
                    var balance = state.balance;
                    if ( Math.floor( .99 * balance ) - ( invoice_amt * 1000 ) < 0 ) {
                        var err_msg = `you must leave 1% in reserve to pay routing fees so the max amount you can pay is ${Math.floor( ( .99 * balance ) / 1000 )} sats and this invoice is for ${invoice_amt} sats`;
                        bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "err_msg" ] = err_msg;
                        var reply = JSON.stringify({
                            result_type: command.method,
                            error: {
                                code: "INSUFFICIENT_BALANCE",
                                message: `you must leave 1% in reserve to pay routing fees so the max amount you can pay is ${Math.floor( ( .99 * balance ) / 1000 )} sats and this invoice is for ${invoice_amt} sats`,
                            },
                            result: {}
                        });
                        var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                        return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                    }

                    var response_from_mint = await bankify.send( mymint, invoice, null, app_pubkey );
                    //response is one of three things:
                    //1. payment failed
                    //2. payment succeeded -- the preimage is in your browser console
                    //3. you cannot send this amount because you need an extra ${amount - bankify.getBalance()} sats to pay for potential LN routing fees. Try sending a bit less

                    if ( !response_from_mint.startsWith( "payment succeeded" ) ) {
                        var err_msg = response_from_mint;
                        bankify.state.nostr_state.nwc_info[ app_pubkey ].tx_history[ pmthash ][ "err_msg" ] = err_msg;
                        var reply = JSON.stringify({
                            result_type: command.method,
                            error: {
                                code: "OTHER",
                                message: response_from_mint,
                            },
                            result: {}
                        });
                        var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                        return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                    }

                    var preimage_to_return = state.tx_history[ pmthash ][ "preimage" ];
                    var reply = JSON.stringify({
                        result_type: "pay_invoice",
                        result: {
                            preimage: preimage_to_return,
                        },
                    });
                    var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                    return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                }
            } catch ( e ) {
                try {
                    var reply = JSON.stringify({
                        result_type: command.method,
                        error: {
                            code: "OTHER",
                            message: `unknown error`,
                        },
                        result: {}
                    });
                    var event = await super_nostr.prepEvent( state[ "app_privkey" ], super_nostr.encrypt( state[ "app_privkey" ], event.pubkey, reply ), 23195, [ [ "p", event.pubkey ], [ "e", event.id ] ] );
                    return super_nostr.sendEvent( event, bankify.state.nostr_state.sockets[ app_pubkey ] );
                } catch( e2 ) {}
            }
        }
        var getRecipientFromNostrEvent = event => {
            var i; for ( i=0; i<event.tags.length; i++ ) {
                if ( event.tags[ i ] && event.tags[ i ][ 0 ] && event.tags[ i ][ 1 ] && event.tags[ i ][ 0 ] == "p" ) return event.tags[ i ][ 1 ];
            }
        }
        var nostrLoop = async app_pubkey => {
            var relay = myrelay;
            bankify.state.nostr_state.sockets[ app_pubkey ] = new WebSocket( relay );
            bankify.state.nostr_state.sockets[ app_pubkey ].addEventListener( 'message', handleEvent );
            bankify.state.nostr_state.sockets[ app_pubkey ].addEventListener( 'open', ()=>{listen( bankify.state.nostr_state.sockets[ app_pubkey ], app_pubkey );} );
            var connection_failure = false;
            var innerLoop = async ( tries = 0 ) => {
                if ( connection_failure ) return console.log( `your connection to nostr failed and could not be restarted, please refresh the page` );
                if ( bankify.state.nostr_state.sockets[ app_pubkey ].readyState === 1 ) {
                    await super_nostr.waitSomeSeconds( 1 );
                    return innerLoop();
                }
                // if there is no connection, check if we are still connecting
                // give it two chances to connect if so
                if ( bankify.state.nostr_state.sockets[ app_pubkey ].readyState === 0 && !tries ) {
                    await super_nostr.waitSomeSeconds( 1 );
                    return innerLoop( 1 );
                }
                if ( bankify.state.nostr_state.sockets[ app_pubkey ].readyState === 0 && tries ) {
                    connection_failure = true;
                    return;
                }
                // otherwise, it is either closing or closed
                // ensure it is closed, then make a new connection
                bankify.state.nostr_state.sockets[ app_pubkey ].close();
                await super_nostr.waitSomeSeconds( 1 );
                bankify.state.nostr_state.sockets[ app_pubkey ] = new WebSocket( relay );
                bankify.state.nostr_state.sockets[ app_pubkey ].addEventListener( 'message', handleEvent );
                bankify.state.nostr_state.sockets[ app_pubkey ].addEventListener( 'open', ()=>{listen( bankify.state.nostr_state.sockets[ app_pubkey ], app_pubkey );} );
                await innerLoop();
            }
            await innerLoop();
            await nostrLoop( app_pubkey );
        }
        if ( !app_pubkey ) {
            var relay = myrelay;
            var app_privkey = super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var app_pubkey = nobleSecp256k1.getPublicKey( app_privkey, true ).substring( 2 );
            var user_secret = super_nostr.bytesToHex( nobleSecp256k1.utils.randomPrivateKey() );
            var user_pubkey = nobleSecp256k1.getPublicKey( user_secret, true ).substring( 2 );
            var nwc_string = `nostr+walletconnect://${app_pubkey}?relay=${relay}&secret=${user_secret}`;
            bankify.state.nostr_state.nwc_info[ app_pubkey ] = {
                permissions,
                mymint,
                nwc_string,
                app_privkey,
                app_pubkey,
                user_secret,
                user_pubkey,
                relay,
                balance: 0,
                tx_history: {},
            }
        }
        nostrLoop( app_pubkey );
        var waitForConnection = async () => {
            if ( bankify.state.nostr_state.sockets[ app_pubkey ].readyState === 1 ) return;
            console.log( 'waiting for connection...' );
            await super_nostr.waitSomeSeconds( 1 );
            return waitForConnection();
        }
        await waitForConnection();
        console.log( `connected!` );
        if ( nwc_string ) return nwc_string;
    }
}
