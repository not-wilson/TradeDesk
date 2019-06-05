// Note: Initial built specific to Windows. Additional OS support can be built in later. AKA I don't own a Mac and my Linux box is CLI.

// Requirements
const { app, BrowserWindow, ipcMain, Menu, MenuItem, nativeImage, Tray } = require('electron')
const { readFile, writeFile } = require('fs')
const BitmexAPI = require('./libs/BitmexAPI')

// Configure Bitmex.
const bitmex = new BitmexAPI
const public = bitmex.register()    // Register a channel for public info needed for app launch.

// Apply basic app operations to all windows.
class AppWindow extends BrowserWindow {
    constructor(conf = null) {
        // Override default window show. Don't open until ready.
        if(typeof conf.show === "undefined") conf.show = false
        if(!conf.token) conf.token  = "XBTUSD"

        // Re-enable nodeIntegration by default.
        if(!conf.webPreferences || !conf.webPreferences.nodeIntegration) {
            if(!conf.webPreferences) conf.webPreferences = { nodeIntegration: true }
            else conf.webPreferences.nodeIntegration = true
        }

        // Build BrowserWindow object with modified settings.
        super(conf)

        // Set custom configs.
        this.token = conf.token

        // Build Window menu.
        const changeWindow = (menu, window, event) => {
            // Erm.. preventDefault()
            menu.checked = false
            menu.menu.items.find(m => {
                if(m.label === this.token) {
                    m.checked = true
                    return
                }
            })

            // Show window if exists, build window if not.
            if(menu.label !== this.token) {
                const win = Desk.windows[menu.label]
                if(win) {
                    win.show()
                    this.hide()
                } else {
                    this.send('startswap') // Turns window into loading screen.
                    Desk.windows[menu.label] = new AppWindow({ width: 800, height: 600, token: menu.label })
                    Desk.windows[menu.label].once('ready-to-show', () => {
                        this.hide()
                        this.send('swapover') // Returns window to previous state.
                    })
                }
            }
        }

        const menu = new Menu()
        menu.append(new MenuItem({ label: "File", submenu: [{ role: "close", label: "Close" }] }))
        menu.append(new MenuItem({ label: "Accounts", submenu: [{ type: "separator" }, { label: "Add Account" }] }))
        menu.append(new MenuItem({ label: "Tokens", submenu: Desk.tokens.map(token => { return { label: token.symbol, type: "radio", click: changeWindow, checked: token.symbol === this.token } }) }))

        // Load default settings.
        this.loadFile(`${__dirname}/UI/main.html`)
        this.setMenu(menu)
        
        // Window Events.
        //this.on('close', e => { e.preventDefault(); this.hide() }) // Hide on close.
        this.once('ready-to-show', () => { 
            this.send('token', this.token)
            this.show() 
        })

        
    }
}

// App Namespace
const Desk = {
    tokens: [],
    windows: [],

    init: async () => {
        Desk.tokens = await public.get('instrument/active')
        Desk.windows['ETHUSD'] = new AppWindow({ height: 600, width: 800, token: "ETHUSD" })
    },

    shutdown: async () => {
        console.log("Shutting donw. D=")
    }
}

// Trigger app launch when ready.
app.once('ready', Desk.init)
app.once('before-quit', Desk.shutdown) // TODO save window size, loc / state on exit.

// Helper Functions - save load
async function loadConfig() {
    return new Promise(cb => { // Called from async function. Save on a try{} catch(e) {} block with a simple if().
        readFile('./config.json', 'utf8', (err, data) => {
            if(err) cb(err)
            else    cb(JSON.parse(data))
        })
    })
}

const saveConfig = () => {
    return new Promise(cb => {
        writeFile('./config.json', JSON.stringify(config), 'utf8', err => {
            if(err) cb(err)
            else    cb()
        })
    })
}