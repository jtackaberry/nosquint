// chrome://browser/content/browser.xul
// open dialogs will raise if already open
function readLines(aURL) {
  var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                  .getService(Components.interfaces.nsIIOService);
  var scriptableStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
                         .getService(Components.interfaces.nsIScriptableInputStream);

  var channel = ioService.newChannel(aURL, null, null);
  var input = channel.open();
  scriptableStream.init(input);
  var str = scriptableStream.read(input.available());
  scriptableStream.close();
  input.close();
  return str.split("\n");
} 

function debug(msg) {
    dump("[nosquint] " + msg + "\n");
}

var NoSquint = {

    TLDs: null,                     // Hash of multi-level TLDs; shared between windows
    prefs: null,                    // Prefs service rooted at extensions.nosquint.
    mousePrefs: null,               // Prefers service rooted at mousewheel.withcontrolkey.
    initialized: false,             // True when init() was called
    prefsRecursion: 0,              // Recursion level in observe()
    saveTimer: null,                // Timer for saveSiteList()
    zoomAllTimer: null,             // Timer for zoomAll()
    pruneTimer: null,               // Timer for pruneSites()
    sitesDirty: false,              // True when sites list needs saving
    ignoreNextSitesChange: false,
    zoomManagerTimeout: null,
    globalDialog: null,
    siteDialog: null,

    /* Prefs */

    // Sites hash is keyed on site name, with value being [level, timestamp, visits]
    sites: {},
    exceptions: [],
    defaultZoomLevel: 120,
    saveDelay: 5000,
    zoomIncrement: 10,
    rememberSites: true,
    wheelZoomEnabled: false,
    hideStatus: false,
    forgetMonths: 6,
    fullZoomPrimary: false,


    init: function() {
        debug("start init");
        NoSquint.updateZoomMenu();
        if (NoSquint.initialized)
            return;
        NoSquint.initialized = true;

        var t0 = new Date().getTime();

        /* The multi-level TLDs list is an object shared between all windows.
         * First iterate over all existing windows to see if we can find it;
         * this prevents us from parsing the ~2000 line file each time a window
         * is opened.  If not, read it from the two-level-tlds file.
         */
        var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                           .getService(Components.interfaces.nsIWindowMediator);
        var windows = wm.getEnumerator("navigator:browser");
        var win;
        while (win = windows.getNext()) {
            if (win._noSquintTLDs) {
                // Found, grab a reference to the object.
                NoSquint.TLDs = window._noSquintTLDs = win._noSquintTLDs;
                break;
            }
        }
        if (NoSquint.TLDs == null) {
            // TLDs list not found in any existing window.  Load the stored list,
            // which is borrowed from http://www.surbl.org/two-level-tlds
            lines = readLines('chrome://nosquint/content/two-level-tlds');
            window._noSquintTLDs = NoSquint.TLDs = {};
            for (var i in lines)
                NoSquint.TLDs[lines[i]] = true;
        }

        NoSquint.initPrefs();

        window.addEventListener("DOMMouseScroll", NoSquint.handleScrollWheel, false); 
        gBrowser.tabContainer.addEventListener("TabOpen", NoSquint.handleNewTab, false);
        gBrowser.tabContainer.addEventListener("TabClose", NoSquint.handleCloseTab, false);
        gBrowser.tabContainer.addEventListener("TabSelect", NoSquint.handleTabChanged, false);

        // Zoom any tabs anther extension may have opened and attach listeners to them.
        NoSquint.zoomAll(true);

        var t1 = new Date().getTime();
        debug("initialization took " + (t1-t0) + " ms");
    },

    destroy: function() {
        NoSquint.prefs.removeObserver("", NoSquint);
        NoSquint.mousePrefs.removeObserver("", NoSquint);

        if (NoSquint.sitesDirty) {
            NoSquint._saveSiteListTimer();
        }

        /* Even though we've removed the pref observers, they lamely still get
         * invoked during setIntPref below; setting prefs to null here prevents
         * full entry into observe().  We're done with it now anyway.
         */
        NoSquint.prefs = null;
        // Restore mousewheel.withcontrolkey.action to default if wheel zoom enabled.
        if (NoSquint.mousePrefs && NoSquint.wheelZoomEnabled && NoSquint.mousePrefs.getIntPref("action") == 0)
            NoSquint.mousePrefs.setIntPref("action", 5);

        gBrowser.tabContainer.removeEventListener("TabOpen", NoSquint.handleNewTab, false);
        gBrowser.tabContainer.removeEventListener("TabClose", NoSquint.handleCloseTab, false);
        gBrowser.tabContainer.removeEventListener("TabSelect", NoSquint.handleTabChanged, false);
    },

    updateZoomMenu: function() {
        var bundle = document.getElementById("nosquint-overlay-bundle");
        var popup = document.getElementById('viewFullZoomMenu').childNodes[0];
        var full_zoom_primary = NoSquint.fullZoomPrimary;
        var toggle_zoom = null;

        if (!NoSquint.initialized) {
            for (var i = 0; i < popup.childNodes.length; i++) {
                var child = popup.childNodes[i];
                if (child.id == 'toggle_zoom')
                    toggle_zoom = child;
                if (child.nodeName != 'menuitem' || (child.command != 'cmd_fullZoomEnlarge' && 
                    child.command != 'cmd_fullZoomReduce'))
                    continue;

                var icon = document.defaultView.getComputedStyle(child, null).getPropertyValue('list-style-image');
                var enlarge = child.command == 'cmd_fullZoomEnlarge';
                var item = document.createElement('menuitem');
                var suffix = "noSquint" + (enlarge ? "Enlarge" : "Reduce") + "Secondary";
                item.setAttribute("command",  "cmd_" + suffix);
                item.setAttribute("key",  "key_" + suffix);
                item.style.listStyleImage = icon;
                popup.insertBefore(item, popup.childNodes[i + 2]);
                if (0 && icon) {
                    // Override toolbar icon to use platform-native enlarge icon
                    var button = document.getElementById("nosquint-button-" + (enlarge ? "enlarge" : "reduce"));
                    if (button)
                        button.style.listStyleImage = icon.replace(/menu/, 'toolbar');
                    if (enlarge) {
                        document.getElementById('nosquint-status').src =  icon.replace(/url\((.*)\)/, "$1");
                    }
                }
            }
            var item = document.createElement('menuitem');
            item.setAttribute('command', 'cmd_noSquintPrefs');
            item.setAttribute('label', bundle.getString('zoomMenuSettings'));
            if (toggle_zoom)
                popup.replaceChild(item, toggle_zoom);
            else {
                popup.appendChild(document.createElement('menuseparator'));
                popup.appendChild(item);
            }
        }

        for (var i = 0; i < popup.childNodes.length; i++) {
            var child = popup.childNodes[i];
            if (child.nodeName != 'menuitem')
                continue;
            var command = child.getAttribute('command');
            if (command == "cmd_fullZoomEnlarge")
                child.setAttribute('label', bundle.getString('zoomMenuIn' + (full_zoom_primary ? "Full" : "Text")));
            else if (command == "cmd_noSquintEnlargeSecondary")
                child.setAttribute('label', bundle.getString('zoomMenuIn' + (full_zoom_primary ? "Text" : "Full")));
            if (command == "cmd_fullZoomReduce")
                child.setAttribute('label', bundle.getString('zoomMenuOut' + (full_zoom_primary ? "Full" : "Text")));
            else if (command == "cmd_noSquintReduceSecondary")
                child.setAttribute('label', bundle.getString('zoomMenuOut' + (full_zoom_primary ? "Text" : "Full")));
        }
    },

    cmdEnlargePrimary: function() {
        NoSquint.fullZoomPrimary ? NoSquint.enlargeFullZoom() : NoSquint.enlargeTextZoom();
    },
    cmdReducePrimary: function() {
        NoSquint.fullZoomPrimary ? NoSquint.reduceFullZoom() : NoSquint.reduceTextZoom();
    },
    cmdEnlargeSecondary: function() {
        NoSquint.fullZoomPrimary ? NoSquint.enlargeTextZoom() : NoSquint.enlargeFullZoom();
    },
    cmdReduceSecondary: function() {
        NoSquint.fullZoomPrimary ? NoSquint.reduceTextZoom() : NoSquint.reduceFullZoom();
    },
    cmdReset: function() {
        var text_zoom_default = NoSquint.getZoomDefaults()[0];
        var viewer = getBrowser().mCurrentBrowser.markupDocumentViewer;
        if (Math.round(viewer.textZoom * 100.0) != text_zoom_default)
            viewer.textZoom = text_zoom_default / 100.0;
        if (!ZoomManager.reset()) {
            NoSquint.saveCurrentZoom();
            NoSquint.updateStatus();
        }
    },
    buttonEnlarge: function(event) {
        event.shiftKey ? NoSquint.cmdEnlargeSecondary() : NoSquint.cmdEnlargePrimary();
    },
    buttonReduce: function(event) {
        event.shiftKey ? NoSquint.cmdReduceSecondary() : NoSquint.cmdReducePrimary();
    },
    enlargeTextZoom: function() {
        getBrowser().mCurrentBrowser.markupDocumentViewer.textZoom += (NoSquint.zoomIncrement / 100.0);
        NoSquint.saveCurrentZoom();
        NoSquint.updateStatus();
    },
    reduceTextZoom: function() {
        getBrowser().mCurrentBrowser.markupDocumentViewer.textZoom -= (NoSquint.zoomIncrement / 100.0);
        NoSquint.saveCurrentZoom();
        NoSquint.updateStatus();
    },
    enlargeFullZoom: function() {
        ZoomManager.enlarge();
    },
    reduceFullZoom: function() {
        ZoomManager.reduce();
    },

    popupItemSelect: function(event) {
        var item = event.target;
        var label = item.label;
        if (label.search(/%$/) != -1) {
            var level = parseInt(label.replace(/%/, ''));
            var browser = gBrowser.selectedBrowser;
            if (item.getAttribute('name') == 'text')
                NoSquint.zoom(browser, level, false);
            else
                NoSquint.zoom(browser, false, level);
            NoSquint.saveCurrentZoom();
        }
    },

    statusPanelClick: function(event) {
        if (event.button == 0)
            return NoSquint.openSitePrefsDialog();

        var popup = document.getElementById("nosquint-status-popup");
        var browser = gBrowser.selectedBrowser;

        // Hide all but the last menuitem if there is no site
        for (var i = 0; i < popup.childNodes.length - 1; i++)
            popup.childNodes[i].style.display = browser._noSquintSite ? '' : 'none';

        var popup_text = document.getElementById("nosquint-status-popup-text");
        var popup_full = document.getElementById("nosquint-status-popup-full");

        var current_text = Math.round(browser.markupDocumentViewer.textZoom * 100);
        var current_full = Math.round(browser.markupDocumentViewer.fullZoom * 100);

        popup.childNodes[0].label = browser._noSquintSite;

        for (var i = 0; i < popup_text.childNodes.length; i++) {
            var child = popup_text.childNodes[i];
            child.setAttribute('checked', child.label.replace(/%/, '') == current_text);
        }
        for (var i = 0; i < popup_full.childNodes.length; i++) {
            var child = popup_full.childNodes[i];
            child.setAttribute('checked', child.label.replace(/%/, '') == current_full);
        }

        popup.openPopupAtScreen(event.screenX, event.screenY, true);
    },

    openSitePrefsDialog: function() {
        var browser = gBrowser.selectedBrowser;
        var site = NoSquint.getSiteFromURI(browser.currentURI);
        if (!site)
            return;
        if (NoSquint.siteDialog) {
            NoSquint.siteDialog.setValues(browser, site);
            return NoSquint.siteDialog.dialog.focus();
        }
        if (NoSquint.sitesDirty)
            NoSquint._saveSiteListTimer();
        window.openDialog("chrome://nosquint/content/siteprefs.xul", "NoSquint Site Settings", "chrome", 
                          NoSquint, browser, site);
    },


    openGlobalPrefsDialog: function() {
        if (NoSquint.globalDialog)
            return NoSquint.globalDialog.dialog.focus();

        if (NoSquint.sitesDirty)
            NoSquint._saveSiteListTimer();
        var browser = gBrowser.selectedBrowser;
        var site = NoSquint.getSiteFromURI(browser.currentURI);
        var level = NoSquint.getLevelForSite(site)[0] || "default";
        var url = browser.currentURI.asciiHost + browser.currentURI.path;
        window.openDialog("chrome://nosquint/content/globalprefs.xul", "NoSquint Settings", "chrome", 
                          site, level, url, NoSquint);
    },


    handleScrollWheel: function(event) {
        if (!event.ctrlKey || !NoSquint.wheelZoomEnabled)
            return;
        var browser = gBrowser.selectedBrowser;
        var text = full = false;
        var increment = NoSquint.zoomIncrement * (event.detail < 0 ? 1 : -1);
        if (NoSquint.fullZoomPrimary && !event.shiftKey || !NoSquint.fullZoomPrimary && event.shiftKey)
            full = (browser.markupDocumentViewer.fullZoom * 100) + increment;
        else
            text = (browser.markupDocumentViewer.textZoom * 100) + increment;
        var current = Math.round(browser.markupDocumentViewer.textZoom * 100);
        NoSquint.zoom(browser, text, full);
        NoSquint.saveCurrentZoom();

        event.stopPropagation();
        event.preventDefault();
    },


    handleTabChanged: function(event) {
        if (gBrowser.selectedBrowser._noSquintified) {
            // ZoomManager.fullZoom was set somewhere internally in FF.  Abort
            // the pending zoom.
            NoSquint.abortPendingZoomManager();
            NoSquint.updateStatus();
        }
    },

    handleNewTab: function(event) {
        NoSquint.attach(event.target.linkedBrowser);
    },

    handleCloseTab: function(event) {
        var browser = event.target.linkedBrowser;
        browser.removeProgressListener(browser._noSquintListener);
    },

    /* In init.js, we hook the setter for ZoomManager.zoom to have it
     * queue the requested zoom rather than apply it immediately.  This
     * gives handleTabChanged() above and our custom ProgressListener an
     * opportunity to abort the pending zoom, in order to fully bypass
     * FF's new internal per-site zoom mechanism.
     */
    abortPendingZoomManager: function() {
        debug("aborting pending ZoomManager zoom");
        if (NoSquint.zoomManagerTimeout != null) {
            clearTimeout(NoSquint.zoomManagerTimeout);
            NoSquint.zoomManagerTimeout = null;
            ZoomManager._nosquintPendingZoom = null;
        } else
            NoSquint.zoomManagerTimeout = false;
    },


    getBaseDomainFromHost: function(host) {
        if (host.match(/^[\d.]+$/) != null)
            // IP address.
            return host;

        var parts = host.split('.');
        var level2 = parts.slice(-2).join('.');
        var level3 = parts.slice(-3).join('.');
        if (NoSquint.TLDs[level3])
            return parts.slice(-4).join('.');
        else if (NoSquint.TLDs[level2])
            return level3;
        return level2;
    },


    processExceptions: function(exlist) {
        // My eyes!  The googles do nothing!
        function regexpify(pattern, re_star, re_dblstar) {
            var parts = pattern.split(/(\[\*+\]|\*+)/);
            var pattern = [];
            var sub = [];
            var length = 0;
            var wildcards = {
                '*': '(' + re_star + ')',
                '**': '(' + re_dblstar + ')',
                '[*]': re_star,
                '[**]': re_dblstar
            };

            for (var i = 0, n = 1; i < parts.length; i++) {
                var part = parts[i];
                if (part == '')
                    continue;
                if (wildcards[part]) 
                    pattern.push(wildcards[part]);
                else {
                    length += part.length;
                    pattern.push('(' + part + ')');
                }

                if (part[0] == '[')
                    sub.push(part.slice(1, -1));
                else
                    sub.push('$' + n++);

            }
            return [ length, pattern.join(''), sub.join('') ];
        }

        var exceptions = [];
        for (var i = 0; i < exlist.length; i++) {
            var exc = exlist[i]
            if (!exc)
                continue;
            // Escape metacharacters except *
            exc = exc.replace(/([^\w*\[\]])/g, '\\$1');
            // Split into host,path parts.
            var [_, exc_host, exc_path] = exc.match(/([^\/]+)(\\\/.*|$)/);
            var [ len_host, re_host, sub_host] = regexpify(exc_host, '[^.:/]+', '.*');
            var [ len_path, re_path, sub_path] = regexpify(exc_path, '[^/]+', '.*');
            exceptions.push([len_host, re_host, sub_host, len_path, re_path, sub_path]);
        }
        return exceptions;
    },


    getSiteFromURI: function(URI) {
        var t0 = new Date().getTime();
        if (!URI)
            return null;

        var uri_host = URI.asciiHost;
        var uri_path = URI.path;
        var base = NoSquint.getBaseDomainFromHost(uri_host);

        var match = null;
        var match_weight = 0;

        for (var i in NoSquint.exceptions) {
            var [len_host, re_host, sub_host, len_path, re_path, sub_path] = NoSquint.exceptions[i];
            if (re_host != '([^.:/]+)')
                var m1 = uri_host.match(new RegExp('(' + re_host + ')$'));
            else
                // Single star is base name
                var m1 = [null, base];

            var m2 = uri_path.match(new RegExp('^(' + re_path + ')'));

            if (!m1 || !m2)
                continue;

            var cur_weight = len_host * 1000 + len_path;
            if (cur_weight < match_weight)
                continue;

            var site_host = m1[1].replace(new RegExp(re_host), sub_host);
            var site_path = m2[1].replace(new RegExp(re_path), sub_path);
            match = site_host + site_path;
            match_weight = cur_weight;
        }
        var t1 = new Date().getTime();
        debug("getSiteFromURI took " + (t1-t0) + " ms");

        if (match)
            return match;
        return base;
    },


    attach: function(browser) {
        var listener = new ProgressListener(browser);
        browser.addProgressListener(listener, Components.interfaces.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
        browser._noSquintListener = listener;
        NoSquint.zoom(browser, null, null);
        //alert("Create new listener");

        /* Sometimes the onLocationChange handler of the ProgressListener will
         * get fired, and sometimes it won't.  My best guess is this is a
         * race condition, and the location sometimes gets changed before we
         * attach the ProgressListener.  So we call NoSquint.zoom() on this
         * browser explicitly for this initial page, rather than rely on the
         * progress handler.
         */
        // XXX: is this still needed (for iframes)?
        //setTimeout(function() { NoSquint.zoom(browser, null); }, 1);
    },
    
    updateStatus: function() {
        if (NoSquint.hideStatus)
            return;
        var browser = gBrowser.selectedBrowser;
        var text = Math.round(browser.markupDocumentViewer.textZoom * 100);
        var full = Math.round(browser.markupDocumentViewer.fullZoom * 100);
        var [ text_default, full_default ] = NoSquint.getZoomDefaults();

        //text += (text == text_default) ? "% (default)" : "%";
        //full += (full == full_default) ? "% (default)" : "%";

        var e = document.getElementById('nosquint-status')
        if (NoSquint.fullZoomPrimary)
            e.label = full + "%" + (text == text_default ? "" : (" / " + text + "%"));
        else
            e.label = text + "%" + (full == full_default ? "" : (" / " + full + "%"));

        var site = browser._noSquintSite ? browser._noSquintSite : "(none)";
        document.getElementById("nosquint-status-tooltip-site").value = site;
        document.getElementById("nosquint-status-tooltip-full").value = full + "%";
        document.getElementById("nosquint-status-tooltip-text").value = text + "%";
    },

    // Returns array [text_size, full_size]
    getLevelForSite: function(site) {
        if (!site)
            return [null, null];

        if (NoSquint.sites[site])
            return [NoSquint.sites[site][0], NoSquint.sites[site][3]];
        return [null, null];
    },

    getZoomDefaults: function() {
        return [ NoSquint.fullZoomPrimary ? 100 : NoSquint.defaultZoomLevel,
                 NoSquint.fullZoomPrimary ? NoSquint.defaultZoomLevel : 100 ];
    },

    getLevelForBrowser: function(browser) {
        if (!browser._noSquintSite)
            browser._noSquintSite = NoSquint.getSiteFromURI(browser.currentURI);

        var [ text_default, full_default ] = NoSquint.getZoomDefaults();

        if (NoSquint.rememberSites) {
            var site = browser._noSquintSite;
            var [ text, full ] = NoSquint.getLevelForSite(site);
            return [ text || text_default, full || full_default ];
        }
        return [ text_default, full_default ];
    },


    /* Zooms text and/or full zoom to the specified level.  If text or full is
     * null, the default for browser is used.  If it is false, it is
     * untouched.  Status bar is updated, but new level is NOT saved.
     */
    zoom: function(browser, text, full) {
        if (!browser || (text == false && full == false))
            return;

        if (text == null || full == null) {
            var [ site_text, site_full ] = NoSquint.getLevelForBrowser(browser);
            if (text == null)
                text = text || site_text;
            if (full == null)
                full = full || site_full;
        }

        debug("set zoom: text=" + text + ", full=" + full);
        if (text != false)
            browser.markupDocumentViewer.textZoom = text / 100.0;
        if (full != false)
            browser.markupDocumentViewer.fullZoom = full / 100.0;

        browser._noSquintified = true;
        if (browser == gBrowser.selectedBrowser)
            NoSquint.updateStatus();
    },

    zoomAll: function(attach) {
        debug("zooming all tabs; attach listeners = " + attach);
        for (var i = 0; i < gBrowser.browsers.length; i++) {
            var browser = gBrowser.browsers[i];
            if (browser._noSquintSite)
                delete browser._noSquintSite;
            NoSquint.zoom(browser, null, null);
            if (attach)
                NoSquint.attach(browser);
        }
        NoSquint.updateStatus();
    },

    queueZoomAll: function() {
        if (NoSquint.zoomAllTimer != null)
            clearTimeout(NoSquint.zoomAllTimer);
        NoSquint.zoomAllTimer = setTimeout(function() { NoSquint.zoomAll(false); }, 1);
    },

    locationChanged: function(browser, uri) {
        var site = NoSquint.getSiteFromURI(uri);
        if (site != browser._noSquintSite)
            // Site changed; update timestamp on new site.
            NoSquint.updateSiteList(site, null, true);
        browser._noSquintSite = site;
        var [ text, full ] = NoSquint.getLevelForBrowser(browser);
        NoSquint.zoom(browser, text, full);
        if (NoSquint.siteDialog && NoSquint.siteDialog.browser == browser)
            NoSquint.siteDialog.setValues(browser, site);
        // XXX: is this still needed (for iframes) in ff3?
        //setTimeout(function() { NoSquint.zoom(browser, NoSquint.getLevelForBrowser(browser)); }, 1);
    },


    pruneSites: function() {
        if (!NoSquint.rememberSites || NoSquint.forgetMonths == 0)
            return;
    
        var remove = [];
        var now = new Date();
        for (var site in NoSquint.sites) {
            if (!NoSquint.sites[site])
                continue
            var [text, timestamp, counter, full] = NoSquint.sites[site];
            var age = now - new Date(timestamp);
            var prune = (age > NoSquint.forgetMonths*30*24*60*60*1000);
            if (prune)
                remove.push(site);
            debug("prune check: " + site + ", age=" + Math.round(age/1000/60/60/24) + 
                 " days, prune=" + prune);
        }
        if (remove.length) {
            for (var i = 0; i < remove.length; i++)
                delete NoSquint.sites[remove[i]];
            NoSquint.saveSiteList();
        }

        // Fire timer once a day.
        if (NoSquint.pruneTimer == null)
            NoSquint.pruneTimer = setTimeout(function() { NoSquint.pruneTimer = null; NoSquint.pruneSites(); }, 
                                             24*60*60*1000);
            
    },

    /* Saves the current tab's zoom level in the site list.
     */
    saveCurrentZoom: function() {
        if (!NoSquint.rememberSites)
            return;

        var browser = gBrowser.selectedBrowser;
        var text = Math.round(browser.markupDocumentViewer.textZoom * 100);
        var full = Math.round(browser.markupDocumentViewer.fullZoom * 100);
        NoSquint.updateSiteList(browser, [text, full]);
    },

    updateSiteList: function(site_or_browser, levels, update_timestamp) {
        var site = site_or_browser;
        if (typeof(site_or_browser) != "string")
            site = site_or_browser._noSquintSite;
        if (!site)
            return false;

        if (update_timestamp) {
            if (!levels && !NoSquint.sites[site])
                // No need to update the timestamp for a site we're not remembering.
                return false;
            NoSquint.sites[site][1] = new Date().getTime();
            NoSquint.sites[site][2] += 1;
            NoSquint.saveSiteList();
        } 
        if (levels) {
            var [ text_default, full_default ] = NoSquint.getZoomDefaults();
            var [ text, full ] = levels;
            [ text, full ] = [ text == text_default ? 0 : text, full == full_default ? 0 : full ];

            if (!text && !full) {
                if (!NoSquint.sites[site])
                    // No settings for this site, nothing to do.
                    return;
                // Setting site to default zoom level, remove it from list.
                delete NoSquint.sites[site];
            } else {
                if (!NoSquint.sites[site])
                    NoSquint.sites[site] = [text, new Date().getTime(), 1, full];
                else {
                    NoSquint.sites[site][0] = text;
                    NoSquint.sites[site][3] = full;
                }
                // TODO: go through current tabs and resize tabs for this site
            }
            NoSquint.saveSiteList();
        }
        return true;
    },

    /* Stores the site list in the prefs service.
     *
     * NOTE: This must only be called when the list has actually changed, or
     * else the next time a change is made in the Settings dialog, it will
     * be ignored.
     */
    saveSiteList: function() {
        if (NoSquint.saveTimer != null)
            clearTimeout(NoSquint.saveTimer);

        NoSquint.sitesDirty = true;
        // The list is actually saved (by default) 5s later, so if the user
        // changes the zoom several times in a short period of time, we aren't
        // needlessly iterating over the sites array.
        NoSquint.saveTimer = setTimeout(function() { NoSquint._saveSiteListTimer(); }, NoSquint.saveDelay);
    },

    _saveSiteListTimer: function() {
        /* XXX: this can take up to 20ms (!!!) even with a smallish sites list
         * (about 50).  If it scales linearly, this could be a problem.  Need
         * to do some more serious benchmarking here.  Looks like setCharPref
         * can trigger pref observer handlers synchronously, so time elapsed
         * includes the time the handlers take too.
         */
        var t0 = new Date().getTime();
        var sites = [];
        for (var site in NoSquint.sites) {
            if (!NoSquint.sites[site])
                continue
            var [text, timestamp, counter, full] = NoSquint.sites[site];
            sites.push(site + "=" + text + "," + timestamp + "," + counter + "," + full);
        }
        var siteList = sites.join(" ");
        /* It's a precondition that the site list has changed, so when we set
         * the pref it will fire a notification that we'll handle in 
         * prefsChanged() which is not necessary here.  So set a flag that causes
         * the next prefs notification for sites change to be ignored.
         */
        NoSquint.ignoreNextSitesChange = true;
        NoSquint.prefs.setCharPref("sites", siteList);
        debug("sites save took: " + (new Date().getTime() - t0) + "ms");
        clearTimeout(NoSquint.saveTimer);
        NoSquint.saveTimer = null;
        NoSquint.sitesDirty = false;
    },

    initPrefs: function() {
        if (NoSquint.prefs)
            return;

        var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(
                          Components.interfaces.nsIPrefService);
        NoSquint.prefs = prefs.getBranch("extensions.nosquint.");
        NoSquint.mousePrefs = prefs.getBranch("mousewheel.withcontrolkey.");

        // Backward compatibility: convert old prefs.
        try { 
            // In 0.9.80, domains renamed to sites
            var domains = NoSquint.prefs.getCharPref("domains");
            NoSquint.prefs.setCharPref("sites", domains);
            NoSquint.prefs.clearUserPref("domains");
        } catch (err) {}

        try { 
            // In 0.9.80, rememberDomains renamed to rememberSites
            var rememberDomains = NoSquint.prefs.getBoolPref("rememberDomains");
            NoSquint.prefs.setBoolPref("rememberSites", rememberDomains);
            NoSquint.prefs.clearUserPref("rememberDomains");
        } catch (err) {} 

        var prefs = [
            "zoomIncrement", "wheelZoomEnabled", "zoomIncrement", "hideStatus", "zoomlevel", "action",
            "sitesSaveDelay", "rememberSites", "exceptions", "sites", "forgetMonths", "fullZoomPrimary"
        ];
        for (var i in prefs)
            NoSquint.observe(null, "nsPref:changed", prefs[i]);

    
        
        NoSquint.prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
        NoSquint.prefs.addObserver("", NoSquint, false);
        NoSquint.mousePrefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
        NoSquint.mousePrefs.addObserver("", NoSquint, false);
    },

    observe: function(subject, topic, data) {
        if (topic != "nsPref:changed" || typeof(NoSquint) == 'undefined' || !NoSquint.prefs)
            return;

        NoSquint.prefsRecursion++;

        switch (data) {
            case "action":
                if (NoSquint.prefsRecursion > 1)
                    break;
                /* If mousewheel.withcontrolkey.action has changed (perhaps via another
                 * extension or edited manually by the user) try to do something
                 * sensible.  If the action is set to 3 (default) then we enable the No
                 * Squint wheel zoom hooks and then set the action to 0 (otherwise we
                 * will never see events.  If it is set to any other value, we disable
                 * the hook for wheel zoom.
                 */
                var action = NoSquint.mousePrefs.getIntPref("action");
                if (action == 3 || action == 5) {
                    NoSquint.prefs.setBoolPref("wheelZoomEnabled", true);
                    //alert("Setting wheelZoomEnabled=true, action=0 because action == 3");
                    NoSquint.mousePrefs.setIntPref("action", 0);
                } else if (action != 0) {
                    //alert("Setting wheelZoomEnabled=false because action != 3 == " + action);
                    NoSquint.prefs.setBoolPref("wheelZoomEnabled", false);
                }
                break;

            case "zoomlevel":
                NoSquint.defaultZoomLevel = NoSquint.prefs.getIntPref("zoomlevel");
                NoSquint.queueZoomAll();
                break;

            case "wheelZoomEnabled":
                NoSquint.wheelZoomEnabled = NoSquint.prefs.getBoolPref("wheelZoomEnabled");
                //alert("Pref wheelZoomEnabled changed to " + NoSquint.wheelZoomEnabled);
                if (NoSquint.wheelZoomEnabled)
                    NoSquint.mousePrefs.setIntPref("action", 0);
                break;

            case "zoomIncrement":
                NoSquint.zoomIncrement = NoSquint.prefs.getIntPref("zoomIncrement");
                break;

            case "forgetMonths":
                NoSquint.forgetMonths = NoSquint.prefs.getIntPref("forgetMonths");
                NoSquint.pruneSites();
                break;

            case "fullZoomPrimary":
                NoSquint.fullZoomPrimary = NoSquint.prefs.getBoolPref("fullZoomPrimary");
                NoSquint.updateZoomMenu();
                NoSquint.queueZoomAll();
                break;

            case "hideStatus":
                NoSquint.hideStatus = NoSquint.prefs.getBoolPref("hideStatus");
                document.getElementById("nosquint-status").hidden = NoSquint.hideStatus;
                if (!NoSquint.hideStatus)
                    NoSquint.handleTabChanged();

                /*
                if (NoSquint.hideStatus)
                    gBrowser.tabContainer.removeEventListener("TabSelect", NoSquint.handleTabChanged, false);
                else {
                    gBrowser.tabContainer.addEventListener("TabSelect", NoSquint.handleTabChanged, false);
                    NoSquint.handleTabChanged();
                }
                */
                break;

            case "rememberSites":
                NoSquint.rememberSites = NoSquint.prefs.getBoolPref("rememberSites");
                NoSquint.queueZoomAll();
                break;

            case "sitesSaveDelay":
                NoSquint.saveDelay = NoSquint.prefs.getIntPref("sitesSaveDelay");
                break;

            case "exceptions":
                // Parse exceptions list from prefs
                var exlist = NoSquint.prefs.getCharPref("exceptions").replace(/(^\s+|\s+$)/g, "").split(" ");
                //var list = NoSquint.parseExceptions(NoSquint.prefs.getCharPref("exceptions"));
                NoSquint.exceptions = NoSquint.processExceptions(exlist);
                NoSquint.queueZoomAll();
                break;

            case "sites":
                /* Parse site list from prefs.  The prefs string a list of site specs,
                 * delimited by a space, in the form sitename=level,timestamp,visits.
                 * Spaces are not allowed in any value.  Level, timestamp, and visits
                 * are all integers.  The parsing code tries to be robust and handle
                 * malformed entries gracefully (in case the user edits them manually
                 * and screws up).
                 */
                // TODO: look at nsIContentPrefService
                if (NoSquint.ignoreNextSitesChange) {
                    NoSquint.ignoreNextSitesChange = false;
                    break;
                }
                var sitesStr = NoSquint.prefs.getCharPref("sites");

                // Trim whitespace and split on space.
                var sites = sitesStr.replace(/(^\s+|\s+$)/g, "").split(" ");
                var now = new Date().getTime();
                NoSquint.sites = {};
                for (var i = 0; i < sites.length; i++) {
                    var parts = sites[i].split("=");
                    if (parts.length != 2)
                        continue; // malformed
                    var [site, info] = parts;
                    var parts = info.split(',');
                    NoSquint.sites[site] = [parseInt(parts[0]) || 0, now, 1, 0];
                    if (parts.length > 1)
                        NoSquint.sites[site][1] = parseInt(parts[1]) || now;
                    if (parts.length > 2)
                        NoSquint.sites[site][2] = parseInt(parts[2]) || 1;
                    if (parts.length > 3)
                        NoSquint.sites[site][3] = parseInt(parts[3]) || 0;

                }
                if (NoSquint.sitesDirty) {
                    /* FIXME: looks like the sites list pref was updated (possibly by
                     * another browser window) before we got a chance to write out our
                     * changes.  We have lost them now; we should try to merge only
                     * newer changes based on timestamp.
                     */
                    NoSquint.sitesDirty = false;
                }
                NoSquint.queueZoomAll();
                break;
            }
        NoSquint.prefsRecursion--;
    }
};



// Listener used to receive notifications when a new URI is about to be loaded.
function ProgressListener(browser) {
    this.browser = browser;
    this.update = false;
}

ProgressListener.prototype.QueryInterface = function(aIID) {
    if (aIID.equals(Components.interfaces.nsIWebProgressListener) ||
        aIID.equals(Components.interfaces.nsISupportsWeakReference) ||
        aIID.equals(Components.interfaces.nsISupports))
        return this;
    throw Components.results.NS_NOINTERFACE;
}

ProgressListener.prototype.onLocationChange = function(progress, request, uri) {
    /* This is called when it's confirmed a URL is loading (including reload).
     * We set a flag here to update the zoom levels on the next state change
     * rather than doing it immediately, because sometime between now and then
     * firefox's internal full zoom gets reset, and we want to update full
     * zoom after that happens (to override it, in effect).
     */
    debug("Location change: " + uri.spec);
    this.update = true;
    NoSquint.abortPendingZoomManager();
    NoSquint.locationChanged(this.browser, this.browser.currentURI);
}

ProgressListener.prototype.onStateChange = function(progress, request, state, status) {
    /*
    if (this.update) {
        this.update = false;
        NoSquint.locationChanged(this.browser, this.browser.currentURI);
    }
    */
    if (!progress.isLoadingDocument) {
        if (NoSquint.sitesDirty)
            NoSquint.saveSiteList();
    } else if (NoSquint.saveTimer) {
        // Browser is not idle and we have a sites list save pending.  Clear
        // the timer, we will save it out after we're done loading all pages.
        clearTimeout(NoSquint.saveTimer);
        NoSquint.saveTimer = null;
    }
}

ProgressListener.prototype.onProgressChange =
ProgressListener.prototype.onStatusChange =
ProgressListener.prototype.onSecurityChange =
ProgressListener.prototype.onLinkIconAvailable = function() {
    return 0;
}
