// Requirements.
const EventEmitter          = require('events')
const Websocket             = require('ws')
const { createHmac }        = require('crypto')
const { request, Agent }    = require('https')

// Socket Handler - Send and Receive Messages from Bitmex Data Stream.
class Socket {
    constructor(bitmex) {
        const socket = new Websocket('wss://www.bitmex.com/realtimemd')

        const keepAlive = {
            timer: null,
            start: () => { keepAlive.timer = setTimeout(() => socket.send("ping"), 10000) },
            stop: () => { clearTimeout(keepAlive.timer) },
            reset: () => {
                keepAlive.stop()
                keepAlive.start()
            }
        }
    
        const sockConnect = () => {
            // Connect all existing clients and subscribe to respective streams.
            bitmex.list().map(account => account.connect())

            // Start Ping-Pong and emit events.
            keepAlive.start()
            bitmex.emit('connect')
        }

        const sockDisconnect = () => {
            // Manually trigger client disconnect events as they won't be triggered otherwise.
            bitmex.list().map(account => {
                account.emit('disconnect')
                bitmex.emit('disconnect', account)
            })

            // Stop Ping-Pong and emit events.
            keepAlive.stop()
            bitmex.emit('disconnect')
        }

        const sockMessage = msg => {
            keepAlive.reset()
            if(msg !== "pong") {
                const result    = JSON.parse(msg)
                const type      = result[0]
                const account   = bitmex.account(result[1])
                const reply     = result[3]

                // Standard communication packets.
                if(type === 0) {

                    // Connection Message
                    if(reply.info && reply.docs && reply.timestamp && reply.version) {
                        account.emit('connect')
                        bitmex.emit('connect', account)
                    }

                    // Authentication Message
                    if(reply.success && reply.request && reply.request.op === "authKeyExpires") {
                        account.emit('auth')
                        bitmex.emit('auth', account)
                    }

                    // Subscription Messages
                    if(reply.success && reply.subscribe) {
                        const stream = account.stream(reply.subscribe)
                        if(stream) {
                            stream.emit('subscribe')
                            account.emit('subscribe', stream)
                            bitmex.emit('subscribe', account, stream)
                        }
                    }

                    if(reply.success && reply.unsubscribe) {
                        const stream = account.stream(reply.subscribe)
                        if(stream) {
                            stream.emit('unsubscribe')
                            account.emit('unsubscribe', stream)
                            bitmex.emit('unsubscribe', account, stream)
                        }
                    }

                    // Stream Messages
                    if(reply.table && reply.action) {
                        let stream = account.stream(reply.table)

                        // Could not find the stream top-level, it may be lower. chat:1, trade:XBTUSD etc.
                        if(!stream) {
                            let key = ""
                            if(reply.filterKey)             key = `${reply.table}:${reply.data[0][reply.filterKey]}` // Found in chat table.
                            else if(reply.data[0].symbol)   key = `${reply.table}:${reply.data[0].symbol}`
                            stream = account.stream(key)
                        }

                        // If we've found stream, finish.
                        if(stream) {
                            stream.emit('message', reply)
                            account.emit('message', stream, reply)
                            bitmex.emit('message', account, stream, reply)

                        // Stream could not be identified. Sorry but, crash the API I reckon.
                        } else throw new Error(`API ERROR: Cannot identify stream object for ${reply.table}`)
                    }

                    // Auto-Cancel Response. // Note: Developer hasn't implemented any use cases for this yet, so this code is basically untested/unrefined.
                    if(reply.now && reply.request && reply.request.op === "cancelAllAfter") {
                        if(reply.cancelTime) {
                            account.emit('autoCancel', reply.cancelTime)
                            bitmex.emit('autoCancel', account, reply.cancelTime)
                        } else {
                            account.emit('autoCancelStop')
                            bitmex.emit('autoCancelStop', account)
                        }
                    }

                    // Stream Errors
                    if(reply.status && reply.error) {
                        account.emit('error', reply)
                        bitmex.emit('error', account, reply)
                    }
                }

                // Manually disconnect an individual stream.
                if(type === 2) {
                    // Emit disconnection message.
                    account.emit('disconnect')
                    bitmex.emit('disconnect', account)
                }
            }
        }

        const sockError = (err, res) => {
            if(res) {
                let result = ""
                res.on('data', data => result += data)
                res.on('end', () => bitmex.emit('error', result))   // This will probably be in HTML. TODO: Parse it into JSON Error Object first.
            } else bitmex.emit('error', err)
        }

        socket.on('open', sockConnect)
        socket.on('close', sockDisconnect)
        socket.on('message', sockMessage)
        socket.on('error', sockError)
        socket.on('unexpected-error', sockError)

        // Send messages on the socket.
        this.emit = (account, data = null, type = 0) => {
            // Generate a default command.
            const command = [type, account.key(), account.key()]

            // Add data if it exists.
            if(data) command.push(data)

            // Fire message to the socket if possible.
            if(socket.readyState === 1) socket.send(JSON.stringify(command))
        }
    }
}

// Pretty sure this is like, just a stock event emitter.
class BitmexStream extends EventEmitter {
    constructor(id) {
        super()
        this.id = () => { return id }
    }
}

class BitmexAccount extends EventEmitter {
    constructor(key = null, secret = null, socket, api) {
        super()

        // Set a default identifier if one is absent (global/public streams don't require key/secret pairs).
        if(!key) key = Math.random().toString(36).substring(2)

        // Fetch Info Functions
        this.key    = () => { return key }
        this.secret = () => { return secret }

        // Socket Handler.
        const send = (data = null, type = 0) => { socket.emit(this, data, type) }

        // Called on object creation and socket connection. Only really needs to be called manually if this.disconnect() has been.
        this.connect = () => {
            // Establish connection.
            send(null, 1)

            // Send authentication.
            if(this.key() && this.secret()) {
                const expires = Math.floor(new Date().getTime() / 1000) + 60
                send({ op: "authKeyExpires", args: [this.key(), expires, createHmac('sha256', this.secret()).update('GET/realtime' + expires).digest('hex')] })
            }

            // Build list of channels and send subscription request.
            send({ op: "subscribe", args: this.list(true) })
        }

        // Fire off a manual disconnection request.
        this.disconnect = () => { send(null, 2) }

        // Stream Handler.
        const streams = {}
        this.stream = id => {
            if(streams[id]) return streams[id]
            else return false
        }
        
        // Get a list of account objects or keys.
        this.list = (clean = false) => { 
            if(!clean) return Object.keys(streams).map(key => { return streams[key] }) 
            else return Object.keys(streams)
        }

        // Handle the dead-mans-switch portion of the code.
        this.autoCancel = time => { send({ op: "cancelAllAfter", args: time }) }

        // The same code for subscribe and unsubscribe.
        const splitChannels = (channels) => {
            const x = channels.map(channel => {
                let stream = streams[channel]
                if(stream) return stream
                else {
                   stream = new BitmexStream(channel)
                   streams[channel] = stream
                   return stream 
                }
            })
            return x.length === 1 ? x[0] : x
        }

        this.subscribe = (...channels) => {
            send({ op: "subscribe", args: channels })
            return splitChannels(channels)
        }

        this.unsubscribe = (...channels) => {
            send({ op: "unsubscribe", args: channels })
            return splitChannels(channels)
        }

        // REST API Stuff.
        const agent = new Agent({ keepAlive: true })

        const restRequest = (dir, data = null, type = 'GET') => {
            // Parse the data if required.
            if(data) {
                if(Array.isArray(data)) data = { orders: data } // Should only be for /order/bulk.
                data = JSON.stringify(data)
            }

            return new Promise((accept, reject) => {
                const options = {
                    hostname: 'www.bitmex.com',
                    port:       443,
                    path:       `/api/v1/${dir}`,
                    method:     type,
                    agent:      agent,
                    headers: {
                        'Content-Type':     'application/json',
                        'Content-Length':   data ? Buffer.byteLength(data) : 0,
                    }
                }
        
                // Public channels will reject if any one of these is present and/or the signature is invalid.
                if(this.key() && this.secret()) {
                    const expires                       = Math.floor(new Date().getTime() / 1000) + 60
                    options.headers['api-expires']      = expires
                    options.headers['api-key']          = this.key()
                    options.headers['api-signature']    = createHmac('sha256', this.secret()).update(`${type}${options.path}${expires}${data ? data : ''}`).digest('hex')
                }
        
                const req = request(options, res => {
                    let result = ""
                    res.setEncoding = "utf8"
                    res.on('data', d => result += d)
                    res.on('end', () => {
                        // This is an HTML Document. Most likely an error of some kind.
                        if(result.indexOf('<') === 0) {
                            reject(result) // TODO: Parse HTML and return representing object.
                            this.emit('error', { key: 'REST' }, result)
                            api.emit('error', this, { key: 'REST' }, result)
                        // Return parsed JSON result.
                        } else {
                            result = JSON.parse(result)
                            if(result.error) {
                                reject(result)
                                this.emit('error', { key: 'REST' }, result)
                                api.emit('error', this, { key: 'REST' }, result)
                            } else {
                                accept(result)
                                this.emit('message', { key: 'REST' }, result)
                                api.emit('message', this, { key: 'REST' }, result)
                            }
                        }
                    })
                })
        
                // Trigger catch() on stream error.
                req.on('error', err => {
                    reject(err)

                    this.emit('error', { key: 'REST' }, err)
                    api.emit('error', this, { key: 'REST' }, err)
                })
        
                // Send any data for the request.
                if(data) req.write(data)
                
                // Finish the request.
                req.end()
            })
        }

        this.get    = (dir)         => { return restRequest(dir, null, 'GET') }
        this.post   = (dir, data)   => { return restRequest(dir, data, 'POST') }
        this.put    = (dir, data)   => { return restRequest(dir, data, 'PUT') }
        this.delete = (dir, data)   => { return restRequest(dir, data, 'DELETE') }

        // on object creation
        this.connect()
    }
}

class BitmexAPI extends EventEmitter {
    constructor() {
        super()
        // Socket Handler.
        const socket = new Socket(this)

        // Accounts Handler.
        const accounts = {}
        this.list = () => { return Object.keys(accounts).map(key => { return accounts[key] }) }

        this.account = id => {
            if(accounts[id]) return accounts[id]
            else return false
        }

        this.register = (key = null, secret = null) => {
            const account = new BitmexAccount(key, secret, socket, this)
            accounts[account.key()] = account
            return account
        }
    }
}

// Export API
module.exports = BitmexAPI