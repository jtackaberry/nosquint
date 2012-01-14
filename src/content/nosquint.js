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

var NoSquint = {

    TLDs: null,         // Hash of multi-level TLDs; shared between windows
    prefs: null,        // Prefs service rooted at extensions.nosquint.
    mousePrefs: null,   // Prefers service rooted at mousewheel.withcontrolkey.
    initialized: false, // True when init() was called
    prefsRecursion: 0,  // Recursion level in observe()
    saveTimer: null,    // Timer for saveSiteList()
    zoomAllTimer: null, // Timer for zoomAll()
    pruneTimer: null,   // Timer for pruneSites()
    sitesDirty: false,  // True when sites list needs saving
    ignoreNextSitesChange: false,

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


    init: function() {
        if (NoSquint.initialized)
            return;

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

        NoSquint.initialized = true;
        // Zoom any tabs anther extension may have opened and attach listeners to them.
        NoSquint.zoomAll(true);

        var t1 = new Date().getTime();
        dump("NoSquint: initialization took " + (t1-t0) + " ms\n");
    },

    destroy: function() {
        var pbi = NoSquint.prefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
        pbi.removeObserver("", this);
        pbi = NoSquint.mousePrefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
        pbi.removeObserver("", this);

        if (NoSquint.sitesDirty)
            NoSquint._saveSiteListTimer();

        /* Even though we've removed the pref observers, they lamely still get
         * invoked during setIntPref below; setting prefs to null here prevents
         * full entry into observe().  We're done with it now anyway.
         */
        NoSquint.prefs = null;
        // Restore mousewheel.withcontrolkey.action to default if wheel zoom enabled.
        if (NoSquint.mousePrefs && NoSquint.wheelZoomEnabled && NoSquint.mousePrefs.getIntPref("action") == 0)
            NoSquint.mousePrefs.setIntPref("action", 3);

        gBrowser.tabContainer.removeEventListener("TabOpen", NoSquint.handleNewTab, false);
        gBrowser.tabContainer.removeEventListener("TabClose", NoSquint.handleCloseTab, false);
        gBrowser.tabContainer.removeEventListener("TabSelect", NoSquint.handleTabChanged, false);
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
        //var t0 = new Date().getTime();

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

            site_host = m1[1].replace(new RegExp(re_host), sub_host);
            site_path = m2[1].replace(new RegExp(re_path), sub_path);
            match = site_host + site_path;
            match_weight = cur_weight;
        }
        //var t1 = new Date().getTime();
        //dump("NoSquint: getSiteFromURI took " + (t1-t0) + " ms\n");

        if (match)
            return match;
        return base;
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


    handleTabChanged: function(event) {
        if (gBrowser.selectedBrowser._noSquintified)
            NoSquint.updateStatus();
    },

    handleNewTab: function(event) {
        NoSquint.attach(event.target.linkedBrowser);
    },

    handleCloseTab: function(event) {
        var browser = event.target.linkedBrowser;
        browser.removeProgressListener(browser._noSquintListener);
    },

    attach: function(browser) {
        var listener = new ProgressListener(browser);
        browser.addProgressListener(listener, Components.interfaces.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
        browser._noSquintListener = listener;
        //alert("Create new listener");

        /* Sometimes the onLocationChange handler of the ProgressListener will
         * get fired, and sometimes it won't.  My best guess is this is a
         * race condition, and the location sometimes gets changed before we
         * attach the ProgressListener.  So we call NoSquint.zoom() on this
         * browser explicitly for this initial page, rather than rely on the
         * progress handler.
         */
        setTimeout(function() { NoSquint.zoom(browser, null); }, 1);
    },
    
    updateStatus: function() {
        if (NoSquint.hideStatus)
            return;
        var browser = gBrowser.selectedBrowser;
        var level = Math.round(browser.markupDocumentViewer.textZoom * 100);
        var label = level + "%";
        if (browser._noSquintSite)
            label += " (" + browser._noSquintSite + ")";
        document.getElementById('nosquint-status').label = label;
    },

    getLevelForSite: function(site) {
        if (!site)
            return null;

        if (NoSquint.sites[site])
            return NoSquint.sites[site][0];
        return null;
    },

    getLevelForBrowser: function(browser) {
        if (!browser._noSquintSite)
            browser._noSquintSite = NoSquint.getSiteFromURI(browser.currentURI);

        if (NoSquint.rememberSites) {
            var site = browser._noSquintSite;
            var level = NoSquint.getLevelForSite(site);
            if (level != null)
                return level;
        }
        return NoSquint.defaultZoomLevel;
    },

    zoom: function(browser, level) {
        if (!browser)
            return;
        if (level == null)
            level = NoSquint.getLevelForBrowser(browser);

        browser.markupDocumentViewer.textZoom = level / 100.0;
        browser._noSquintified = true;
        if (browser == gBrowser.selectedBrowser)
            NoSquint.updateStatus();
    },

    zoomAll: function(attach) {
        dump("NoSquint: zooming all tabs; attach listeners = " + attach + "\n");
        for (var i = 0; i < gBrowser.browsers.length; i++) {
            var browser = gBrowser.browsers[i];
            if (browser._noSquintSite)
                delete browser._noSquintSite;
            NoSquint.zoom(browser, null);
            if (attach)
                NoSquint.attach(browser);
        }
    },

    queueZoomAll: function() {
        dump("NoSquint: queuing zoom all\n");
        if (NoSquint.zoomAllTimer != null)
            clearTimeout(NoSquint.zoomAllTimer);
        NoSquint.zoomAllTimer = setTimeout(function() { NoSquint.zoomAll(false); }, 1);
    },

    openPrefsDialog: function() {
        var browser = gBrowser.selectedBrowser;
        var site = NoSquint.getSiteFromURI(browser.currentURI);
        var level = NoSquint.getLevelForSite(site) || "default";
        var url = browser.currentURI.asciiHost + browser.currentURI.path;
        window.openDialog("chrome://nosquint/content/prefs.xul", "NoSquint Settings", "chrome", 
                          site, level, url, NoSquint);
    },


    locationChanged: function(browser, uri) {
        var site = NoSquint.getSiteFromURI(uri);
        if (site != browser._noSquintSite)
            // Site changed; update timestamp on new site.
            NoSquint.updateSiteList(site, null, true);
        browser._noSquintSite = site;
        setTimeout(function() { NoSquint.zoom(browser, NoSquint.getLevelForBrowser(browser)); }, 1);
    },


    pruneSites: function() {
        if (!NoSquint.rememberSites || NoSquint.forgetMonths == 0)
            return;
    
        var remove = [];
        var now = new Date();
        for (var site in NoSquint.sites) {
            if (!NoSquint.sites[site])
                continue
            var [level, timestamp, counter] = NoSquint.sites[site];
            var age = now - new Date(timestamp);
            var prune = (age > NoSquint.forgetMonths*30*24*60*60*1000);
            if (prune)
                remove.push(site);
            dump("NoSquint: prune check: " + site + ", age=" + Math.round(age/1000/60/60/24) + 
                 " days, prune=" + prune + "\n");
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
        var current_level = Math.round(browser.markupDocumentViewer.textZoom * 100);
        NoSquint.updateSiteList(browser, current_level);
    },

    updateSiteList: function(site_or_browser, level, update_timestamp) {
        var site = site_or_browser;
        if (typeof(site_or_browser) != "string")
            site = site_or_browser._noSquintSite;
        if (!site)
            return false;
        if (update_timestamp) {
            if (!level && !NoSquint.sites[site])
                // No need to update the timestamp for a site we're not remembering.
                return false;
            NoSquint.sites[site][1] = new Date().getTime();
            NoSquint.sites[site][2] += 1;
            NoSquint.saveSiteList();
        } 
        if (level) {
            level = parseInt(level) || NoSquint.defaultZoomLevel;
            if (level == NoSquint.defaultZoomLevel) {
                if (!NoSquint.sites[site])
                    // No settings for this site, nothing to do.
                    return;
                // Setting site to default zoom level, remove it from list.
                delete NoSquint.sites[site];
            } else {
                if (!NoSquint.sites[site])
                    NoSquint.sites[site] = [level, new Date().getTime(), 1];
                else
                    NoSquint.sites[site][0] = level;
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
            var [level, timestamp, counter] = NoSquint.sites[site];
            sites.push(site + "=" + level + "," + timestamp + "," + counter);
        }
        var siteList = sites.join(" ");
        /* It's a precondition that the site list has changed, so when we set
         * the pref it will fire a notification that we'll handle in 
         * prefsChanged() which is not necessary here.  So set a flag that causes
         * the next prefs notification for sites change to be ignored.
         */
        NoSquint.ignoreNextSitesChange = true;
        NoSquint.prefs.setCharPref("sites", siteList);
        dump("NoSquint: Sites save took: " + (new Date().getTime() - t0) + "ms\n");
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
            "zoomIncrement", "wheelZoomEnabled", "zoomIncrement", "hideStatus", "zoomlevel",
            "sitesSaveDelay", "rememberSites", "exceptions", "sites", "forgetMonths"
        ];
        for (var i in prefs)
            NoSquint.observe(null, "nsPref:changed", prefs[i]);

        var pbi = NoSquint.prefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
        pbi.addObserver("", this, false);
        pbi = NoSquint.mousePrefs.QueryInterface(Components.interfaces.nsIPrefBranchInternal);
        pbi.addObserver("", this, false);
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
                if (action == 3) {
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

            case "hideStatus":
                NoSquint.hideStatus = NoSquint.prefs.getBoolPref("hideStatus");
                document.getElementById("nosquint-status").hidden = NoSquint.hideStatus;
                if (NoSquint.hideStatus)
                    gBrowser.tabContainer.removeEventListener("TabSelect", NoSquint.handleTabChanged, false);
                else {
                    gBrowser.tabContainer.addEventListener("TabSelect", NoSquint.handleTabChanged, false);
                    NoSquint.handleTabChanged();
                }
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
                    NoSquint.sites[site] = [parseInt(parts[0]) || NoSquint.defaultZoomLevel, now, 1];
                    if (parts.length > 1)
                        NoSquint.sites[site][1] = parseInt(parts[1]) || now;
                    if (parts.length > 2)
                        NoSquint.sites[site][2] = parseInt(parts[2]) || 1;

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
    /* XXX: it makes sense that if the URI hasn't changed we don't need to
     * change zoom, but there seems to be a bug in ff where if the page contains
     * frames, reloads will not apply the browser's zoom level to the frame. 
     * So this we make sure we reset the textzoom level for all page loads.
     */
    this.lastURI = uri.spec;
    NoSquint.locationChanged(this.browser, uri);
}

ProgressListener.prototype.onStateChange = function(progress) {
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
