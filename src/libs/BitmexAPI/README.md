# BitmexAPI
BitmexAPI Socket and REST API event handler.

#Usage
>
    // Declaration.
    const bitmex    = new BitmexAPI // Creat API instance. Connects to socket immediately.
    const account   = bitmex.register(API_KEY, API_SECRET)  // Register a key/secret pair to handle subscription channels. Returns Account object.
    const public    = bitmex.register() // No API Key/Secret pair returns access to public channels only.
    const channel   = account.subscribe('trade:XBTUSD')     // Returns a stream object.
    
    // const channels  = account.subscribe('position', 'instrument')   // Returns an array of stream objects.

    // Usage.
    bitmex.on('connect', acc => {
        if(!acc) console.log("Master socket connection established.")
        else console.log(`${acc.key()} has been connected.`)
    })

    account.on('connect', () => {
        console.log(`${account.key()} has connected.`)
    })

    bitmex.on('auth', acc => {
        console.log(`Master acknowledges ${acc.key()} has been authorised.`)
    })

    account.on('auth', () => {
        console.log(`${account.key()} has been authorised.`)
    })

    bitmex.on('subscribe', (acc, chan) => {
        console.log(`Master acknowledges ${acc.key()} has subscribed to ${chan.id()}`)
    })

    account.on('subscribe', chan => {
        console.log(`${account.key()} acknowledges its subscription to ${chan.id()}`)
    })

    channel.on('subscribe', () => {
        console.log(`${channel.id()} acknowledges its existence.`)
    })

    // REST API.
    public.get('instrument/active').then(data => console.log(data) )
    account.get('user').then(data => console.log(data) )

    // TODO: Docs for POST/PUT/DELETE
    // Write better docs in general.