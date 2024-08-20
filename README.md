# Bankify
Turn any cashu mint into a lightning wallet with NWC support

# What is bankify?
Bankify is a response to a frustration I've had: not enough custodial bitcoin wallets support Nostr Wallet Connect aka NWC. The only ones I'm aware of (til I released this app) are getalby.com, cashu.me, and mutiny wallet if you configure it to use a federation first. But mutiny wallet is [shutting down](https://blog.mutinywallet.com/mutiny-wallet-is-shutting-down/) and alby wallet [stopped opening new accounts](https://stacker.news/items/640256) for their custodial service, so only cashu.me will work in the near future -- and cashu.me is "send only," unfortunately, so it doesn't even support all of the features NWC offers. Bankify to the rescue!

# How can I try it?
Just click here: https://supertestnet.github.io/bankify/

# How does it work?
Cashu mints have a standardized api for "melting" and "minting" ecash tokens, and these api endpoints are effectively the same as "receive" and "send" buttons in other custodial wallets. The "melt" option lets you pay a mint with ecash and in return they will pay a lightning invoice for you, and the "mint" option lets you request a lightning invoice from the mint, such that upon being paid, the mint will give you an equivalent amount of ecash tokens. So I made a simple storage service that does those things automatically in the background, including managing ecash, and just gives you nice and easy Send and Receive buttons. This app *also* runs a Nostr Wallet Connect server in the background so that NWC clients can connect to it and give it commands using *that* standardized api. So essentially this app just translates between two custodial api standards.

# WARNINGS
This wallet stores your private keys and ecash notes unencrypted in localStorage. That means browser extensions and stuff like that can read the data there and steal your money. Moreover, if you clear your cookies very thoroughly, your money will disappear. Beyond that, ecash always comes with the standard "custodial wallet" trust assumptions: if the mint wants to steal from you, it's very easy for them; if they get arrested, your money will probably be gone; if they get hacked, you're out of luck. I made this app for testing purposes and I warn you: don't put any money in it unless you're happy to lose that money for the pursuit of science and the enrichment of someone-who-isn't-you.

Also: the NWC connection lives in the browser tab where you have Bankify open, so if you close that browser tab, it stops working. Therefore, I do not recommend using Bankify for zaps on nostr. Your nostr client will probably try to give it commands while your browser tab is closed, and it just won't work.
