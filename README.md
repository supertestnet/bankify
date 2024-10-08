# Bankify
Turn any cashu mint into a lightning wallet with NWC support

# What is bankify?
Bankify is a library that makes it easy to connect cashu mints to NWC in order to give users of your apps access to the lightning network. I created it in response to a frustration I've had: not enough custodial bitcoin "web wallets" support Nostr Wallet Connect aka NWC. The only ones I'm aware of (til I released this app) are getalby.com, cashu.me, and mutiny wallet if you configure it to use a federation first. But mutiny wallet is [shutting down](https://blog.mutinywallet.com/mutiny-wallet-is-shutting-down/) and alby wallet [stopped opening new accounts](https://stacker.news/items/640256) for their custodial service, so only cashu.me will work in the near future -- and cashu.me is "send only," unfortunately, so it doesn't even support all of the features NWC offers. Bankify to the rescue!

# How can I try it?
Just click here: https://supertestnet.github.io/bankify/

# How does it work?
Cashu mints have a standardized api for "melting" and "minting" ecash tokens, and these api endpoints are effectively the same as "send" and "receive" buttons in other custodial wallets. The "melt" option lets you pay a mint with ecash and in return they will pay a lightning invoice of an equivalent amount for you, and the "mint" option lets you request a lightning invoice from the mint, such that upon being paid, the mint will give you an equivalent amount of ecash tokens. So I made a simple storage service that does those things automatically in the background, including managing ecash, and just gives you nice and easy Send and Receive buttons. This app *also* runs a Nostr Wallet Connect server in the background so that NWC clients can connect to it and give it commands using *that* standardized api. So essentially this app just translates between two custodial api standards.

# Bankify for nodeJS
If you look at the file [bankify_for_nodejs.js](https://github.com/supertestnet/bankify/blob/main/bankify_for_nodejs.js), you'll find a simplified version of bankify. (In some sense it's "de-simplified" because bankify_for_nodejs integrates the super_nostr dependency directly, so it's larger than the "regular" bankify.js.) If you include this .js file in a nodejs package, it should let you run bankify on a server rather than on a webpage. This may also be useful for devs who prefer to write their client apps in nodejs.

# Bankify API
Whether you use bankify.js or bankify_for_nodejs.js, they both have the same, very simple api.

First, select a mint:

```javascript
var mint = "https://mint.coinos.io";
//Find alternative mints at bitcoinmints.com
//Note that currently bankify supports cashu mints but not fedimints
//So don’t use ones that start with fed1, use ones that start with https
```

Second, craft permissions (optional):

```javascript
var permissions = [
    "get_info",
    "get_balance",
    "make_invoice",
    "pay_invoice",
    "lookup_invoice",
    "list_transactions",
];
//See full permissions list here: https://docs.nwc.dev/reference-api/overview
//Note that Bankify only supports the 6 permissions listed above
//Also note that Bankify *defaults* to the permissions above -- so if you don't create a custom permissions array, you'll get the above
```

Third, pick a relay (optional):

```javascript
var relay = "wss://nostrue.com";
//Find alternative relays at https://relays.xport.top/
//Note that Bankify *defaults* to the relay above -- so if you don't create a custom relay variable, you'll get the above
```

Fourth, create your connection string:

```javascript
(async()=>{
    var nwc_string = await bankify.createNWCconnection( mint, permissions, relay );
    console.log( nwc_string );
})();
```

Fifth, you can test the connection string using any nwc_client, such as:

https://supertestnet.github.io/nwc_tester/

Sixth, once you've verified that your NWC connection works as expected, you can interact with it using the NWC api. I have a library for making interactions with NWC easier:

https://github.com/supertestnet/nwcjs

# WARNINGS
The bankify *webapp* includes a wallet that demonstrates the features of the API. This wallet is not safe and not intended to be used except for experiments and demos. A big reason why it is unsafe is because it stores your private keys and ecash notes unencrypted in localStorage. That means browser extensions and stuff like that can read the data there and steal your money. Moreover, if you clear your cookies very thoroughly, your money will disappear. Beyond that, ecash always comes with the standard "custodial wallet" trust assumptions: if the mint wants to steal from you, it's very easy for them; if they get arrested, your money will probably be gone; if they get hacked, you're out of luck. I made the webapp for testing and demonstration purposes and I warn you: don't put any money in it unless you're happy to lose that money for the pursuit of science and the enrichment of someone-who-isn't-you.

Also: the webapp's NWC connection lives in the browser tab where you have Bankify open, so if you close that browser tab, it stops working. Therefore, I do not recommend using bankify.js for zaps on nostr. Your nostr client will probably try to give it commands while your browser tab is closed, and it just won't work. For that use case, consider using bankify_for_nodejs.js instead.
