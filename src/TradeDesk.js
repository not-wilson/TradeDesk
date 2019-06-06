// Note: Initial built specific to Windows. Additional OS support can be built in later. AKA I don't own a Mac and my Linux box is CLI.
// Fresh clones will need to run npm install inside all of the ./src/libs/* folders to get requirements. I'm not down with npm (or git for that matter) yet.

// Requirements
const { app, BrowserWindow, ipcMain, Menu, MenuItem, nativeImage, Tray } = require('electron')
const { readFile, writeFile } = require('fs')
const BitmexAPI = require('./libs/BitmexAPI')

// Configure Bitmex.
const bitmex = new BitmexAPI
const free = bitmex.register()    // Register a channel for public info needed for app launch.

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
        
        // Handle window menu callbacks.
        const changeWindow = (menu, window, event) => {
            // Force checks to comply.
            if(menu.label !== this.token) menu.checked = false
            else menu.checked = true

            // Selection isn't active window.
            if(!menu.checked) {
                let win = Desk.windows[menu.label]
                if(win) {
                    win.show()
                    this.hide()
                } else {
                    // Add loading screen.
                    this.send('swap-start')

                    // Build new token window.
                    win = new AppWindow({ token: menu.label })
                    win.once('show', () => {
                        this.send('swap-end') // Remove loading screen.
                        this.hide()
                    })

                    // Add token window to main app.
                    Desk.windows[menu.label] = win
                }

                // Move window to current location.
                win.setBounds(this.getBounds())                
            }
        }

        // Build window menu.
        const menu = new Menu()
        menu.append(new MenuItem({ label: "File", submenu: [{ role: "close", label: "Close" }] }))
        menu.append(new MenuItem({ label: "Accounts", submenu: [{ type: "separator" }, { label: "Add Account" }] }))
        menu.append(new MenuItem({ label: "Tokens", submenu: Desk.tokens.map(token => { return { label: token.symbol, type: "checkbox", click: changeWindow, checked: token.symbol === this.token } }) }))

        // Load default settings.
        this.loadFile(`${__dirname}/UI/main.html`)
        this.setMenu(menu)


        // Window Events.
        this.on('close', e => { e.preventDefault(); this.hide() })  // Prevent window close, hide instead.

        this.on('hide', e => {  // Close socket connections and stop receiving data.
            free.unsubscribe(`trade:${this.token}`)
        })

        this.on('show', () => { // Resume socket connections and start receiving data.
            free.subscribe(`trade:${this.token}`).on('message', data => {
                this.send('trade', data)
            })
        })

        // Show window when ready.
        this.once('ready-to-show', this.show)
    }
}

// App Namespace
const Desk = {
    tray:   null,
    tokens: [],
    windows: [],

    init: async () => {
        // Load active instruments to build menus with.
        Desk.tokens = await free.get('instrument/active')

        // Handle Tray clicks.
        const openTokenWindow = (menu, window, event) => {
            const win = Desk.windows[menu.label]
            if(win) win.show()
            else Desk.windows[menu.label] = new AppWindow({ width: 800, height: 600, token: menu.label })
        }

        // Build tray Menu from active BitMEX instruments.
        const tmenu = Menu.buildFromTemplate(Desk.tokens.map(token => { return { label: token.symbol, click: openTokenWindow } }))
        tmenu.append(new MenuItem({ type: "separator" }))
        tmenu.append(new MenuItem({ role: "quit" }))

        // Build Tray.
        Desk.tray = new Tray(nativeImage.createFromPath(`${__dirname}/rsc/images/icon.png`))
        Desk.tray.setContextMenu(tmenu)

        // testing purposes - TODO: Load save, check for existing window conditions, apply.
        Desk.windows['XBTUSD'] = new AppWindow({ token: 'XBTUSD' })
    },

    shutdown: async () => {
        app.exit()  // Force the app to exit in lieu of manually disconnecting all sockets etc. #Laziness #TODO
    }
}

// Trigger app launch when ready.
app.once('ready', Desk.init)
app.once('window-all-closed', e => e.preventDefault) // Stop app from dying if all windows are closed.
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