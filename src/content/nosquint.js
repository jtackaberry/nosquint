var NoSquint = {

    prefs: null,
    mousePrefs: null,
    initialized: false,
    url: null,
    tabbrowser: null,
    listeners: [],
    rObserver: {
        observe: function(subject, topic, data) { NoSquint.prefsChanged(); }
    },
    eatNextPrefChange: false,

    // Prefs
    domains: {},
    defaultZoomLevel: 120,
    rememberDomains: true,
    wheelZoomEnabled: true,
    wheelActionSave: -1,

    init: function() {
        if (NoSquint.initialized)
            return;

        NoSquint.initPrefs();

        NoSquint.tabbrowser = document.getElementById("content");
        NoSquint.tabbrowser.addEventListener("DOMNodeInserted", NoSquint.handleNewBrowser, false);
        window.addEventListener("DOMMouseScroll", NoSquint.handleScrollWheel, false); 

        var pbi = NoSquint.prefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
        pbi.addObserver("", NoSquint.rObserver, false);

        NoSquint.initialized = true;
    },

    destroy: function() {
        var pbi = NoSquint.prefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
        pbi.removeObserver("", NoSquint.rObserver);
        // Restore previous mousewheel.withcontrolkey.action value
        if (NoSquint.mousePrefs && NoSquint.wheelActionSave != -1) {
            NoSquint.mousePrefs.setIntPref("action", NoSquint.wheelActionSave);
            NoSquint.prefs.setIntPref("wheelActionSave", -1);
        }

        // Clean up active progress listeners, unregistering DOMNodeRemoved event listeners
        for (var i = 0; i < NoSquint.listeners.length; i++) {
            var browser = NoSquint.listeners[i].browser;
            browser.parentNode.removeEventListener("DOMNodeRemoved", NoSquint.handleRemoveBrowser, false);
        }
        NoSquint.listeners = [];
        // Unregister the event listeners setup during init.
        NoSquint.tabbrowser.removeEventListener("DOMNodeInserted", NoSquint.handleNewBrowser, false);
        window.removeEventListener("DOMMouseScroll", NoSquint.handleScrollWheel, false);
    },

    handleScrollWheel: function(event) {
        if (!event.ctrlKey || !NoSquint.wheelZoomEnabled)
            return;
        //alert(event.detail + ' -- target -- ' + event.target.nodeName);
        if (event.detail < 0)
            ZoomManager.prototype.getInstance().reduce();
        else if (event.detail > 0)
            ZoomManager.prototype.getInstance().enlarge();

        event.stopPropagation();
        event.preventDefault();
    },

    getCurrentBrowser: function() {
        var nodes = NoSquint.tabbrowser.mPanelContainer.getElementsByTagName("browser");
        var cur = nodes[NoSquint.tabbrowser.mPanelContainer.selectedIndex];
        return cur;
    },

    getDomainFromHost: function(host) {
        return host.replace(/^.*?([^.]*\.[^.]*$)/, "$1");
    },

    handleNewBrowser: function(event) {
        var nodes = NoSquint.tabbrowser.mPanelContainer.getElementsByTagName("browser");
        var last = nodes[nodes.length - 1];
        for (var i = 0; i < NoSquint.listeners.length; i++) {
            if (NoSquint.listeners[i].browser == last) {
                //alert("Not making lisener");
                return;
            }
        }
        last.parentNode.addEventListener("DOMNodeRemoved", NoSquint.handleRemoveBrowser, false);

        var listener = new ProgressListener(last);
        //alert("Create new listener");
        NoSquint.listeners[NoSquint.listeners.length] = listener;
        last.addProgressListener(listener, Components.interfaces.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
        //window.setTimeout(function() { NoSquint.zoom(last, null); }, 1);
    },
    
    handleRemoveBrowser: function(event) {
        var nodes = event.target.getElementsByTagName("browser");
        if (nodes.length == 0) // should this ever happen?
            return;
        // Find the listener for this browser and remove it.
        // XXX: should we assume nodes.length == 1 here, or should we iterate
        // over each node?
        var browser = nodes[0];
        for (var i = 0; i < NoSquint.listeners.length; i++) {
            if (NoSquint.listeners[i].browser == browser) {
                NoSquint.listeners.splice(i, 1);
                return;
            }
        }
    },

    zoom: function(node, domain) {
        if (!node)
            return;

        if (domain == null && node.currentURI)
            domain = NoSquint.getDomainFromHost(node.currentURI.asciiHost);

        try {
            if (!domain)
                throw "blah";
            if (!NoSquint.domains[domain] || !NoSquint.rememberDomains)
                level = NoSquint.defaultZoomLevel;
            else
                level = NoSquint.domains[domain];

            //alert("Set zoom for host: " + host + " -- " + level + " -- " + NoSquint.rememberDomains);
            if (node.markupDocumentViewer.textZoom != level / 100.0)
                node.markupDocumentViewer.textZoom = level / 100.0;
        } catch(ex) {
            window.setTimeout(function() { NoSquint.zoom(node, domain); }, 100);
        }
    },

    zoomAll: function() {
        var nodes;
        try { 
            nodes = NoSquint.tabbrowser.mPanelContainer.getElementsByTagName("browser"); 
        } catch(ex) {
            return;
        }
        for (var i = 0; i < nodes.length; i++) {
            NoSquint.zoom(nodes[i]);
        }
    },

    onMenuItemCommand: function() {
        window.openDialog("chrome://nosquint/content/prefs.xul", "", "chrome");
    },

    initPrefs: function() {
        if (NoSquint.prefs)
            return;

        var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(
                          Components.interfaces.nsIPrefService);
        NoSquint.prefs = prefs.getBranch("extensions.nosquint.");
        NoSquint.mousePrefs = prefs.getBranch("mousewheel.withcontrolkey.");

        try { NoSquint.prefs.getIntPref("zoomlevel"); } 
        catch (err) { NoSquint.prefs.setIntPref("zoomlevel", NoSquint.defaultZoomLevel); }

        try { NoSquint.prefs.getCharPref("domains"); }
        catch (err) { NoSquint.prefs.setCharPref("domains", ""); }

        try { NoSquint.prefs.getBoolPref("rememberDomains"); } 
        catch (err) { NoSquint.prefs.setBoolPref("rememberDomains", NoSquint.rememberDomains); }

        try { NoSquint.prefs.getBoolPref("wheelZoomEnabled"); } 
        catch (err) { NoSquint.prefs.setBoolPref("wheelZoomEnabled", NoSquint.wheelZoomEnabled); }

        try { NoSquint.wheelActionSave = NoSquint.prefs.getBoolPref("wheelActionSave"); } 
        catch (err) { NoSquint.prefs.setIntPref("wheelActionSave", NoSquint.wheelActionSave); }


        if (NoSquint.wheelActionSave == -1) {
            NoSquint.wheelActionSave = NoSquint.mousePrefs.getIntPref("action");
            NoSquint.prefs.setIntPref("wheelActionSave", NoSquint.wheelActionSave);
        }

        NoSquint.mousePrefs.setIntPref("action", 0);
        NoSquint.prefsChanged();
    },

    initPrefsDialog: function(doc) {
        NoSquint.initPrefs();
        doc.getElementById("defaultZoomLevel").value = NoSquint.defaultZoomLevel;
        doc.getElementById("rememberDomains").selectedIndex = NoSquint.rememberDomains ? 0 : 1;
        //doc.getElementById("wheelZoomEnabled").checked = NoSquint.wheelZoomEnabled;
    },

    savePrefs: function(doc) {
        if (doc) {
            NoSquint.prefs.setIntPref("zoomlevel", doc.getElementById("defaultZoomLevel").value);
            var val = doc.getElementById("rememberDomains").selectedIndex == 0 ? true : false;
            NoSquint.prefs.setBoolPref("rememberDomains", val);
            //NoSquint.prefs.setBoolPref("wheelZoomEnabled", doc.getElementById("wheelZoomEnabled").checked);
            return;
        }

        var domains = [];
        for (var domain in NoSquint.domains) {
            if (NoSquint.domains[domain]) {
                domains[domains.length] = domain + "=" + NoSquint.domains[domain];
            }
        }
        var domainList = domains.join(" ");
        NoSquint.eatNextPrefChange = true;
        NoSquint.prefs.setCharPref("domains", domainList);
    },

    prefsChanged: function() {
        if (NoSquint.eatNextPrefChange) {
            NoSquint.eatNextPrefChange = false;
            return;
        }
        NoSquint.defaultZoomLevel = NoSquint.prefs.getIntPref("zoomlevel");
        NoSquint.wheelZoomEnabled = NoSquint.prefs.getBoolPref("wheelZoomEnabled");
        // TODO: if rememberDomains has been changed from false to true, iterate
        // over current browsers and remember current zoom levels for these windows.
        NoSquint.rememberDomains = NoSquint.prefs.getBoolPref("rememberDomains");
        var domainList = NoSquint.prefs.getCharPref("domains");
        var domains = domainList.split(" ");
        NoSquint.domains = {};
        for (var i = 0; i < domains.length; i++) {
            var domain = domains[i].split("=");
            NoSquint.domains[domain[0]] = parseInt(domain[1]);
        }
        NoSquint.zoomAll();
    },

    locationChanged: function(browser, uri) {
        NoSquint.zoom(browser, NoSquint.getDomainFromHost(uri.asciiHost));
    },

    saveCurrentZoom: function() {
        if (!NoSquint.rememberDomains)
            return;

        var browser = NoSquint.getCurrentBrowser();
        var domain = NoSquint.getDomainFromHost(browser.currentURI.asciiHost);
        var level = Math.round(browser.markupDocumentViewer.textZoom * 100);
        if (level != NoSquint.defaultZoomLevel)
            NoSquint.domains[domain] = level;
        else
            delete NoSquint.domains[domain];

        NoSquint.savePrefs(null);
    }
};



// Listener used to receive notifications when a new URI is about to be loaded.
function ProgressListener(browser) {
    this.browser = browser;
    this.lastURI = null;
}

ProgressListener.prototype.QueryInterface = function(aIID) {
    if (aIID.equals(Components.interfaces.nsIWebProgressListener) ||
        aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
        aIID.equals(Components.interfaces.nsISupports))
        return this;
    throw Components.results.NS_NOINTERFACE;
}

ProgressListener.prototype.onLocationChange = function(progress, request, uri) {
    //alert("Location change: " + uri.spec + " -- old: " + this.lastURI);
    if (uri.spec == this.lastURI)
        return;
    this.lastURI = uri.spec;
    NoSquint.locationChanged(this.browser, uri);
}

ProgressListener.prototype.onProgressChange =
ProgressListener.prototype.onStatusChange =
ProgressListener.prototype.onStateChange =
ProgressListener.prototype.onSecurityChange =
ProgressListener.prototype.onLinkIconAvailable = function() {
    return 0;
}
