// chrome://browser/content/browser.xul
var NoSquint = {

    TLDs: null,                     // Hash of multi-level TLDs; shared between windows
    prefs: null,                    // Prefs service rooted at extensions.nosquint.
    browserZoomPrefs: null,         // Prefs service rooted at browser.zoom
    initialized: false,             // True if init() was called
    saveTimer: null,                // Timer for saveSiteList()
    zoomAllTimer: null,             // Timer for zoomAll()
    styleAllTimer:null,             // Timer for styleAll()
    pruneTimer: null,               // Timer for pruneSites()
    sitesDirty: false,              // True when sites list needs saving
    ignoreNextSitesChange: false,   // ignores next update to sites pref
    globalDialog: null,             // NoSquintPrefs object if global prefs dialog open
    siteDialog: null,               // NoSquintSitePrefs object if site prefs dialog open
    observer: null,                 // Instance attached to observer interface
    origSiteSpecific: null,         // Original value of browser.zoom.siteSpecific

    /* Prefs */
    // Sites hash is keyed on site name, with value being:
    //  [textlevel, timestamp, visits, fulllevel, textcolor, bgcolor, nobgimages, 
    //   linkunvis, linkvis, linkunderline]
    sites: {},                      // extensions.nosquint.sites
    exceptions: [],                 // extensions.nosquint.exceptions
    defaultFullZoomLevel: 120,      // extensions.nosquint.fullZoomLevel
    defaultTextZoomLevel: 100,      // extensions.nosquint.textZoomLevel
    saveDelay: 5000,                // extensions.nosquint.sitesSaveDelay
    zoomIncrement: 10,              // extensions.nosquint.zoomIncrement
    rememberSites: true,            // extensions.nosquint.rememberSites
    zoomImages: true,               // extensions.nosquint.zoomImages
    wheelZoomEnabled: true,         // extensions.nosquint.wheelZoomEnabled
    wheelZoomInvert: false,         // extensions.nosquint.wheelZoomInvert
    hideStatus: false,              // extensions.nosquint.hideStatus
    forgetMonths: 6,                // extensions.nosquint.forgetMonths
    fullZoomPrimary: false,         // extensions.nosquint.fullZoomPrimary
    colorText: '0',                 // extensions.nosquint.colorText
    colorBackground: '0',           // extensions.nosquint.colorBackground
    colorBackgroundImages: false,   // extensions.nosquint.colorBackgroundImages
    linksUnvisited: '0',            // extensions.nosquint.linksUnvisited
    linksVisited: '0',              // extensions.nosquint.linksVisited
    linksUnderline: false,          // extensions.nosquint.linksUnderline


    init: function() {
        NoSquint.updateZoomMenu();
        if (NoSquint.initialized)
            return;
        NoSquint.initialized = true;

        var t0 = new Date().getTime();

        /* The multi-level TLDs list is an object shared between all windows.
         * First see if it has already been attached to some window; this
         * prevents us from parsing the ~2000 line file each time a window is
         * opened.  If not, read it from the two-level-tlds file.
         */
        NoSquint.TLDs = window_get_global('tlds');
        if (NoSquint.TLDs == null) {
            // TLDs list not found in any existing window.  Load the stored list,
            // which is borrowed from http://www.surbl.org/two-level-tlds
            lines = readLines('chrome://nosquint/content/two-level-tlds');
            NoSquint.TLDs = {};
            for (var i in lines)
                NoSquint.TLDs[lines[i]] = true;
            window_set_global('tlds', NoSquint.TLDs);
            
        }
        window._noSquint = NoSquint;

        NoSquint.observer = new NoSquintObserver();
        NoSquint.observer.watcher = {
            onEnterPrivateBrowsing: function() {
                // Switching the private browsing mode.  Store any current pending
                // changes now.
                if (NoSquint.sitesDirty)
                    NoSquint._realSaveSiteList(true);
                // Save current (non-private) site data for when we exit private
                // browsing.
                NoSquint._sites_save = NoSquint.cloneSites();
            },

            onExitPrivateBrowsing: function() {
                // Restore previously saved site data and rezoom/style all tabs.
                NoSquint.sites = NoSquint._sites_save;
                NoSquint._sites_save = null;
                NoSquint.zoomAll();
                NoSquint.styleAll();
            }
        };

        // Init prefs, parsing site list.
        NoSquint.initPrefs(true);

        if (NoSquint.observer.inPrivateBrowsing)
            NoSquint.observer.watcher.onEnterPrivateBrowsing();

        window.addEventListener("DOMMouseScroll", NoSquint.handleScrollWheel, false); 
        window.addEventListener("resize", NoSquint.handleResize, false);
        gBrowser.tabContainer.addEventListener("TabOpen", NoSquint.handleNewTab, false);
        gBrowser.tabContainer.addEventListener("TabClose", NoSquint.handleCloseTab, false);
        gBrowser.tabContainer.addEventListener("TabSelect", NoSquint.handleTabChanged, false);

        // Zoom any tabs anther extension may have opened and attach listeners to them.
        NoSquint.zoomAll(true);
        // Style all open tabs.
        NoSquint.styleAll();
        var t1 = new Date().getTime();
        debug("initialization took " + (t1-t0) + " ms");
    },

    destroy: function() {
        NoSquint.prefs.removeObserver("", NoSquint);
        NoSquint.browserZoomPrefs.removeObserver("", NoSquint);

        if (NoSquint.sitesDirty)
            NoSquint._realSaveSiteList();

        /* Even though we've removed the pref observers, they lamely still get
         * invoked during setBoolPref below; setting prefs to null here prevents
         * full entry into observe().  We're done with it now anyway.
         */
        NoSquint.prefs = null;
        // Reenable browser.zoom.siteSpecific
        NoSquint.browserZoomPrefs.setBoolPref("siteSpecific", NoSquint.origSiteSpecific);

        gBrowser.tabContainer.removeEventListener("TabOpen", NoSquint.handleNewTab, false);
        gBrowser.tabContainer.removeEventListener("TabClose", NoSquint.handleCloseTab, false);
        gBrowser.tabContainer.removeEventListener("TabSelect", NoSquint.handleTabChanged, false);
        window.removeEventListener("DOMMouseScroll", NoSquint.handleScrollWheel, false); 
        window.removeEventListener("resize", NoSquint.handleResize, false);
    },

    cloneSites: function() {
        var sites = {};
        for (var site in NoSquint.sites)
            sites[site] = NoSquint.sites[site].slice();
        return sites;
    },

    /* Updates View | Zoom menu to replace the default Zoom In/Out menu
     * items with Primary Zoom In/Out and Secondary Zoom In/Out.  Also the
     * "Zoom Text Only" menuitem is replaced with an option to open the NS
     * Global prefs.
     */
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
                /*
                if (icon) {
                    // Override toolbar icon to use platform-native enlarge icon
                    var button = document.getElementById("nosquint-button-" + (enlarge ? "enlarge" : "reduce"));
                    if (button)
                        button.style.listStyleImage = icon.replace(/menu/, 'toolbar');
                    if (enlarge) {
                        document.getElementById('nosquint-status').src =  icon.replace(/url\((.*)\)/, "$1");
                    }
                }
                */
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


    /* Handlers for toolar buttons */
    buttonEnlarge: function(event) {
        event.shiftKey ? NoSquint.cmdEnlargeSecondary() : NoSquint.cmdEnlargePrimary();
    },
    buttonReduce: function(event) {
        event.shiftKey ? NoSquint.cmdReduceSecondary() : NoSquint.cmdReducePrimary();
    },
    buttonReset: function(event) {
        NoSquint.cmdReset();
    },

    /* Handlers for commands defined in overlay.xul */
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
        var [text, full] = NoSquint.getZoomDefaults();
        var viewer = getBrowser().mCurrentBrowser.markupDocumentViewer;
        var updated = false;

        if (Math.round(viewer.textZoom * 100.0) != text)
            updated = viewer.textZoom = text / 100.0;
        if (Math.round(viewer.fullZoom * 100.0) != full)
            updated = viewer.fullZoom = full / 100.0;
        
        if (updated != false) {
            debug("Reset: save")
            NoSquint.saveCurrentZoom();
            NoSquint.updateStatus();
        }
    },

    enlargeTextZoom: function() {
        var browser = getBrowser().mCurrentBrowser;
        if (is_image(browser))
            return NoSquint.enlargeFullZoom();
        var mdv = browser.markupDocumentViewer;
        mdv.textZoom = Math.round(mdv.textZoom * 100.0 + NoSquint.zoomIncrement) / 100.0;
        NoSquint.saveCurrentZoom();
        NoSquint.updateStatus();
    },
    reduceTextZoom: function() {
        var browser = getBrowser().mCurrentBrowser;
        if (is_image(browser))
            return NoSquint.reduceFullZoom();
        var mdv = browser.markupDocumentViewer;
        mdv.textZoom = Math.round(mdv.textZoom * 100.0 - NoSquint.zoomIncrement) / 100.0;
        NoSquint.saveCurrentZoom();
        NoSquint.updateStatus();
    },
    enlargeFullZoom: function() {
        var browser = getBrowser().mCurrentBrowser;
        if (is_image(browser) && browser._noSquintFit)
            return;
        var mdv = browser.markupDocumentViewer;
        mdv.fullZoom = Math.round(mdv.fullZoom * 100.0 + NoSquint.zoomIncrement) / 100.0;
        NoSquint.saveCurrentZoom();
        NoSquint.updateStatus();
    },
    reduceFullZoom: function() {
        var browser = getBrowser().mCurrentBrowser;
        if (is_image(browser) && browser._noSquintFit)
            return;
        var mdv = browser.markupDocumentViewer;
        mdv.fullZoom = Math.round(mdv.fullZoom * 100.0 - NoSquint.zoomIncrement) / 100.0;
        NoSquint.saveCurrentZoom();
        NoSquint.updateStatus();
    },

    /* Called when a menuitem from the status panel context menu is selected. */
    popupItemSelect: function(event) {
        var item = event.target;
        var label = item.label;
        if (label.search(/%$/) != -1) {
            /* One of the radio menuitems for zoom level was selected (label 
             * ends in %).  Set the zoom level based on the radio's group
             * name.
             */
            var level = parseInt(label.replace(/%/, ''));
            var browser = gBrowser.selectedBrowser;
            if (item.getAttribute('name') == 'text')
                NoSquint.zoom(browser, level, false);
            else
                NoSquint.zoom(browser, false, level);
            NoSquint.saveCurrentZoom();
        }
    },

    /* Handle left/middle/right click on the status panel. */
    statusPanelClick: function(event) {
        if (event.button == 0)
            // Left click, open site prefs.
            return NoSquint.openSitePrefsDialog();
        else if (event.button == 1)
            // Middle click, open global prefs.
            return NoSquint.openGlobalPrefsDialog();

        /* Right click.  Setup the context menu according to the current
         * browser tab: the site name is set, and the appropriate radio 
         * menuitems get selected.
         */
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


    /* Opens the site prefs dialog, or focuses it if it's already open.
     * In either case, the values of the dialog are updated to reflect the
     * current browser tab.
     */
    openSitePrefsDialog: function() {
        var browser = gBrowser.selectedBrowser;
        var site = NoSquint.getSiteFromBrowser(browser);
        if (!site)
            return;
        if (NoSquint.siteDialog) {
            NoSquint.siteDialog.setValues(browser, site);
            return NoSquint.siteDialog.dialog.focus();
        }
        window.openDialog("chrome://nosquint/content/siteprefs.xul", "NoSquint Site Settings", "chrome", 
                          NoSquint, browser, site);
    },


    /* Opens global prefs dialog or focuses it if it's already open. */
    openGlobalPrefsDialog: function() {
        if (NoSquint.globalDialog)
            return NoSquint.globalDialog.dialog.focus();

        var browser = gBrowser.selectedBrowser;
        var host = browser.currentURI.asciiHost;
        try {
            if (browser.currentURI.port > 0)
                host += ':' + browser.currentURI.port;
        } catch (err) {};
        window.openDialog("chrome://nosquint/content/globalprefs.xul", "NoSquint Settings", "chrome", 
                          NoSquint, host + browser.currentURI.path);
    },

    /* Apply increase/decrease for ctrl-mousewheel */
    handleScrollWheel: function(event) {
        if (!event.ctrlKey)
            return;
        if (NoSquint.wheelZoomEnabled) {
            var browser = gBrowser.selectedBrowser;
            var text = full = false;
            var increment = NoSquint.zoomIncrement * (event.detail < 0 ? 1 : -1);
            var img = is_image(browser);
                
            if (NoSquint.wheelZoomInvert)
                increment *= -1;

            if (NoSquint.fullZoomPrimary && !event.shiftKey || !NoSquint.fullZoomPrimary && event.shiftKey || img)
                full = Math.round((browser.markupDocumentViewer.fullZoom * 100) + increment);
            else
                text = Math.round((browser.markupDocumentViewer.textZoom * 100) + increment);

            if (!img || !browser._noSquintFit) {
                NoSquint.zoom(browser, text, full);
                if (browser._noSquintSite)
                    NoSquint.saveCurrentZoom();
            }
        }
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

    /* Given a FQDN, returns only the base domain, and honors two-level TLDs.
     * So for example, www.foo.bar.com returns bar.com, or www.foo.bar.co.uk
     * returns bar.co.uk.
     */
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


    /* Takes an array of exceptions as stored in prefs, and returns a sorted
     * list, where each exception is converted to a regexp grammar.  The list
     * is sorted such that exceptions with the most literal (non-wildcard)
     * characters are first.
     */
    processExceptions: function(exlist) {
        /* This ugly function takes an exception, with our custom
         * grammar, and converts it to a regular expression that we can
         * match later.  Hostname and path components are processed in
         * separate calls; re_star and re_dblstar define the regexp syntax
         * for * and ** wildcards for this pattern.  (This is because
         * wildcards have different semantics for host vs path.)
         *
         * Function returns a list of [length, pattern, sub] where length
         * is the number of literal (non-wildcard) characters, pattern is
         * the regexp that will be used to match against the URI, and sub is
         * used (via regexp.replace) to create the site name based on the
         * URI.
         */
        function regexpify(pattern, re_star, re_dblstar) {
            var parts = pattern.split(/(\[\*+\]|\*+)/);
            var pattern = [];
            var sub = [];
            var length = 0;

            // Maps wildcards in custom grammar to regexp equivalent.
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
            return [length, pattern.join(''), sub.join('')];
        }

        var exceptions = [];
        for (var i = 0; i < exlist.length; i++) {
            var exc = exlist[i]
            if (!exc)
                continue;
            // Escape metacharacters except *
            exc = exc.replace(/([^\w:*\[\]])/g, '\\$1');
            // Split into host and path parts, and regexpify separately.
            var [_, exc_host, exc_path] = exc.match(/([^\/]*)(\\\/.*|$)/);
            var [len_host, re_host, sub_host] = regexpify(exc_host, '[^.:/]+', '.*');
            var [len_path, re_path, sub_path] = regexpify(exc_path, '[^/]+', '.*');
            if (exc_host.search(':') == -1)
                re_host += '(:\\d+)';

            debug("Parse exception: exc_host=" + exc_host + ", re_host=" + re_host + ", sub_host=" + sub_host + ", exc_path=" + exc_path + ", re_path=" + re_path + ", sub_path=" + sub_path);
            exceptions.push([len_host * 1000 + len_path, exc_host, re_host, sub_host, re_path, sub_path]);
        }
        // Sort the exceptions such that the ones with the highest weights
        // (that is, the longest literal lengths) appear first.
        exceptions.sort(function(a, b) { return b[0] - a[0]; });
        return exceptions;
    },
    

    /* Given a browser, returns the site name.  Does not use the cached
     * browser._noSquintSite value.
     */
    getSiteFromBrowser: function(browser) {
        if (is_chrome(browser))
            return null;
        return NoSquint.getSiteFromURI(browser.currentURI);
    },

    /* Given a URI, returns the site name, as computed based on user-defined
     * exceptions.  If no exception matches the URI, we fall back to the base
     * domain name.
     */
    getSiteFromURI: function(URI) {
        var t0 = new Date().getTime();
        if (!URI)
            return null;

        var uri_host = URI.asciiHost;
        var uri_path = URI.path;

        try {
            var uri_port = URI.port < 0 ? 0 : URI.port;
        } catch (err) {
            var uri_port = '0';
        }

        var base = NoSquint.getBaseDomainFromHost(uri_host);
        if (!base && !uri_host)
            // file:// url, use base as /
            base = '/';

        uri_host += ':' + uri_port;

        var match = null;
        
        /* Iterate over each exception, trying to match it with the URI.
         * We break the loop on the first match, because exceptions are
         * sorted with highest weights first.
         */
        for (var i in NoSquint.exceptions) {
            var [weight, exc_host, re_host, sub_host, re_path, sub_path] = NoSquint.exceptions[i];
            if (re_host.substr(0, 11) == '([^.:/]+)(:') // exc_host == *[:...]
                // Single star is base name, so match just that, plus any port spec
                // that's part of the exception.
                re_host = '(' + base + ')' + re_host.substr(9);

            var m1 = uri_host.match(new RegExp('(' + re_host + ')$'));
            var m2 = uri_path.match(new RegExp('^(' + re_path + ')'));

            //debug("check site: host=" + uri_host + ", port=" + uri_port+ ", path=" + uri_path + ", base=" + base + " === exception info: re_host=" + re_host + ", sub_host=" + sub_host + ", re_path=" + re_path + ", sub_path=" + sub_path + " === results: m1=" + m1 + ", m2=" + m2);

            if (!m1 || !m2)
                // No match
                continue;

            var site_host = m1[1].replace(new RegExp(re_host), sub_host);
            var site_path = m2[1].replace(new RegExp(re_path), sub_path);
            match = site_host + site_path;
            break;
        }
        var t1 = new Date().getTime();
        debug("getSiteFromURI took " + (t1-t0) + " ms: " + (match ? match : base));

        return match ? match : base;
    },


    /* Attaches our custom ProgressListener to the given browser. */
    attach: function(browser) {
        var listener = new ProgressListener(browser);
        debug('Attaching new progress listener');
        browser.addProgressListener(listener, Components.interfaces.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
        browser._noSquintListener = listener;
        // Zoom browser to the appropriate levels for the current URI.
        NoSquint.zoom(browser, null, null);

        browser._noSquintStyles = [];
        // Attach stylesheets to new frames as they load.
        function handle_frame_load(event) {
            var doc = event.target.contentWindow.document;
            var head = doc.getElementsByTagName("head");
            var style = browser._noSquintStyles[0].cloneNode(true);
            browser._noSquintStyles.push(style);
            head[0].appendChild(style);
        }
        browser.addEventListener("DOMFrameContentLoaded", handle_frame_load, true);
    },
    
    /* Updates the status panel and tooltip to reflect current site name
     * and zoom levels.
     */
    updateStatus: function() {
        var browser = gBrowser.selectedBrowser;
        // Disable/enable context menu item.
        document.getElementById('nosquint-menu-settings').disabled = browser._noSquintSite == null;

        if (NoSquint.hideStatus)
            // Pref indicates we're hiding status panel, no sense in updating.
            return;

        var text = Math.round(browser.markupDocumentViewer.textZoom * 100);
        var full = Math.round(browser.markupDocumentViewer.fullZoom * 100);
        var [text_default, full_default] = NoSquint.getZoomDefaults();

        var e = document.getElementById('nosquint-status')
        if (browser._noSquintSite) {
            if (NoSquint.fullZoomPrimary)
                e.label = full + "%" + (text == 100 ? "" : (" / " + text + "%"));
            else
                e.label = text + "%" + (full == 100 ? "" : (" / " + full + "%"));
            document.getElementById("nosquint-status-tooltip-site").value = browser._noSquintSite.replace(/%20/g, ' ');
            document.getElementById("nosquint-status-tooltip-full").value = full + "%";
            document.getElementById("nosquint-status-tooltip-text").value = text + "%";

            var style = NoSquint.getStyleForBrowser(browser);
            var label = document.getElementById('nosquint-status-tooltip-textcolor');
            label.style.color = style.text == '0' ? 'inherit' : style.text;
            label.style.backgroundColor = style.bg == '0' ? 'inherit' : style.bg;
            label.value = style.text == '0' && style.bg == '0' ? 'Site Controlled' : 'Sample';

            var vis = document.getElementById('nosquint-status-tooltip-vis-link');
            var unvis = document.getElementById('nosquint-status-tooltip-unvis-link');
            unvis.value = vis.value = "";
            vis.style.color = vis.style.textDecoration = "inherit";
            unvis.style.color = unvis.style.textDecoration = "inherit";

            if (style.unvisited == '0' && style.visited == '0')
                unvis.value = "Site Controlled";
            else {
                if (style.unvisited != '0') {
                    unvis.value = "Unvisited";
                    unvis.style.color = style.unvisited;
                    unvis.style.textDecoration = style.underline ? 'underline' : 'inherit';
                }
                if (style.visited != '0') {
                    vis.value = "Unvisited";
                    vis.style.color = style.visited;
                    vis.style.textDecoration = style.derline ? 'underline' : 'inherit';
                }
            }

            document.getElementById("nosquint-status-tooltip").style.display = '';
            e.style.fontStyle = e.style.color = 'inherit';
        } else {
            document.getElementById("nosquint-status-tooltip").style.display = 'none';
            e.label = 'N/A';
            /* LAME: The documentation for statusbarpanel says there is a
             * disabled attribute.  The DOM Inspector says otherwise.  So we
             * must simulate the disabled look.
             */
            e.style.color = '#777';
            e.style.fontStyle = 'italic';
        }
    },

    /* Gets the style parameters for the given site name.
     */
    getStyleForSite: function(site) {
        if (site && NoSquint.sites[site]) {
            var s = NoSquint.sites[site];
            return { 
                text: s[4],
                bg: s[5],
                bgimages: s[6],
                unvisited: s[7],
                visited: s[8],
                underline: s[9]
            };
        }
        return null;
    },

    getStyleForBrowser: function(browser) {
        if (!browser._noSquintSite)
            browser._noSquintSite = NoSquint.getSiteFromBrowser(browser);
        if (NoSquint.rememberSites)
            var style = NoSquint.getStyleForSite(browser._noSquintSite);
        else
            var style = {text: '0', bg: '0', bgimages: false, unvisited: '0', visited: '0', underline: false};
        return NoSquint.applyStyleDefaults(style);
    },

    applyStyleDefaults: function(style) {
        return {
            text: (style && style.text != '0') ? style.text : NoSquint.colorText,
            bg: (style && style.bg != '0') ? style.bg : NoSquint.colorBackground,
            bgimages: (style && style.bgimages) ? style.bgimages : NoSquint.colorBackgroundImages,
            unvisited: (style && style.unvisited != '0') ? style.unvisited : NoSquint.linksUnvisited,
            visited: (style && style.visited != '0') ? style.visited : NoSquint.linksVisited,
            underline: (style && style.underline) ? style.underline : NoSquint.linksUnderline
        };
    },


    /* Gets the levels for the given site name.  (Note, this is the site name
     * as gotten from getSiteFromURI(), not the URI itself.)  Returns a
     * 2-tuple [text_size, full_size], or [null, null] if the site is not
     * found.  (This means we should use the default zoom.)
     */
    getLevelForSite: function(site) {
        if (site && NoSquint.sites[site])
            return [NoSquint.sites[site][0], NoSquint.sites[site][3]];
        return [null, null];
    },


    /* Returns a 2-tuple [text_default, full_default] representing the default
     * zoom levels.
     */
    getZoomDefaults: function() {
        return [NoSquint.defaultTextZoomLevel, NoSquint.defaultFullZoomLevel];
    },

    /* Returns a 2-tuple [text, full] zoom levels for the given
     * browser.
     */
    getLevelForBrowser: function(browser) {
        if (!browser._noSquintSite)
            browser._noSquintSite = NoSquint.getSiteFromBrowser(browser);

        var [text_default, full_default] = NoSquint.getZoomDefaults();

        if (NoSquint.rememberSites) {
            var site = browser._noSquintSite;
            var [text, full] = NoSquint.getLevelForSite(site);
            return [text || text_default, full || full_default];
        }

        // In global zoom mode, so return the global default levels.
        return [text_default, full_default];
    },


    /* Zooms text and/or full zoom to the specified level.  If text or full is
     * null, the default for browser is used.  If it is false, it is
     * untouched.  Status bar is updated, but new level is NOT saved.
     */
    zoom: function(browser, text, full) {
        if (!browser || (text == false && full == false))
            return;

        if (text == null || full == null) {
            var [site_text, site_full] = NoSquint.getLevelForBrowser(browser);
            if (text == null)
                text = text || site_text;
            if (full == null)
                full = full || site_full;
            // Only zoom web content, not chrome or plugins (e.g. PDF)
            if (!browser._noSquintSite)
                [text, full] = [100, 100];
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

    /* Updates the zoom levels for all tabs; each tab is set to the levels
     * for the current URIs of each browser.  If 'attach' is true, then
     * ProgressListeners are attached to each browser as well.  This is
     * useful on initialization, where we can hook into any tabs that may
     * have been opened prior to initialization.
     */
    zoomAll: function(attach, site) {
        debug("zooming all tabs; attach listeners = " + attach);
        for (var i = 0; i < gBrowser.browsers.length; i++) {
            var browser = gBrowser.browsers[i];
            if (site && site != browser._noSquintSite)
                continue;
            if (browser._noSquintSite)
                delete browser._noSquintSite;
            NoSquint.zoom(browser, null, null);
            if (attach)
                NoSquint.attach(browser);
        }
        NoSquint.updateStatus();
        clearTimeout(NoSquint.zoomAllTimer);
        NoSquint.zoomAllTimer = null;
    },

    /* Queues a zoomAll.  Useful when we might otherwise call zoomAll() 
     * multiple times, such as in the case of multiple preferences being
     * updated at once.
     */
    queueZoomAll: function(site, delay) {
        if (!delay)
            delay = 1;
        if (NoSquint.zoomAllTimer)
            clearTimeout(NoSquint.zoomAllTimer);
        NoSquint.zoomAllTimer = setTimeout(function() { NoSquint.zoomAll(false, site); }, delay);
    },

    queueStyleAll: function(site, delay) {
        if (!delay)
            delay = 1;
        if (NoSquint.styleAllTimer)
            clearTimeout(NoSquint.styleAllTimer);
        NoSquint.styleAllTimer = setTimeout(function() { NoSquint.styleAll(site); }, delay);
    },

    styleAll: function(site) {
        for (var i = 0; i < gBrowser.browsers.length; i++) {
            var browser = gBrowser.browsers[i];
            if (site && site != browser._noSquintSite || is_chrome(browser))
                continue;
            debug("STYLING: " + browser._noSquintSite);
            NoSquint.style(browser);
        }
    },

    handleResize: function(event) {
        if (event.eventPhase != 2)
            return;
        for (var i = 0; i < gBrowser.browsers.length; i++) {
            var browser = gBrowser.browsers[i];
            if (browser._noSquintFit != undefined)
                NoSquint.adjustImage(null, browser, -1);
        }
    },

    adjustImage: function(event, browser, fit) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        var doc = browser.docShell.document;
        var img = doc.body.firstChild;
        var styleobj = browser._noSquintStyles[0];
        fit = fit == undefined ? !browser._noSquintFit : browser._noSquintFit;
        // is any dimension of the image bigger than the window?
        var is_bigger = img.naturalWidth >= doc.body.clientWidth || img.naturalHeight >= doc.body.clientHeight;
        // is the aspect of the image larger than the window (i.e. is it wider)?
        var is_wider = img.naturalWidth/img.naturalHeight > doc.body.clientWidth/doc.body.clientHeight;

        var cursor = (!fit && !is_bigger) || (fit && is_bigger) ? "-moz-zoom-in" : "-moz-zoom-out";
        //var css = "* { cursor: " + cursor + " !important; }";
        var css = "img { cursor: " + cursor + " !important;";
        css += "width: " + (fit && is_wider? "100%" : "auto") + " !important;";
        css += "height: " + (fit && !is_wider ? "100%" : "auto") + " !important;}";
        debug("Fitting: " + fit + ", css: " + css);
        var title = doc.title.replace(/ *- Scaled \(\d+%\)$/, '');
        if (fit) {
            var ratio = is_wider ? doc.body.clientWidth / img.naturalWidth :
                                   doc.body.clientHeight / img.naturalHeight;
            debug("Scale: wider=" + is_wider + ", img=" + img.naturalWidth + "x" + img.naturalHeight+ ", window=" + doc.body.clientWidth + "x" + doc.body.clientHeight);
            title += ' - Scaled (' + parseInt(ratio * 100) + '%)';
            debug(title);
        }
        doc.title = title;
        styleobj.textContent = css;
        browser._noSquintFit = fit;
    },


    style: function(browser, style) {
        var doc = browser.docShell.document;
        var css = '';
        if (!doc.documentElement)
            // Nothing to style; chrome?
            return;

        if (browser._noSquintStyles.length == 0) {
            // Create new style element for this document.
            var styleobj = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
            browser._noSquintStyles.push(styleobj);
            doc.documentElement.appendChild(styleobj);
        }

        if (is_image(browser)) {
            if (doc.body.firstChild) {
                var img = doc.body.firstChild;
                if (img._noSquintAttached == undefined) {
                    browser._noSquintFit = false;
                    NoSquint.adjustImage(null, browser, NoSquint.zoomImages ? undefined : -1);
                    img.addEventListener("click", function(event) { 
                        if (event.button == 0)
                            return NoSquint.adjustImage(event, browser);
                    }, true);
                    img._noSquintAttached = true;
                }
            }
            return;
        }

        if (!style)
            // No style specified, find for this browser.
            style = NoSquint.getStyleForBrowser(browser);

        if (style.text != '0' || style.bg != '0' || style.bgimages || 
            style.unvisited != '0' || style.visited != '0' || style.underline) {
            css = 'body,p,div,span,blockquote,h1,h2,h3,h4,h5,table,tr,th,td,iframe,a {';
            if (style.text != '0')
                css += 'color: ' + style.text + ' !important;';
            if (style.bg != '0')
                css += 'background-color: ' + style.bg + ' !important;';
            if (style.bgimages)
                css += 'background-image: none !important;';
            css += '}\n';

            if (style.unvisited != '0')
                css += 'a:link { color: ' + style.unvisited + ' !important; }\n';
            if (style.visited != '0')
                css += 'a:visited { color: ' + style.visited + ' !important; }\n';
            if (style.underline)
                css += 'a { text-decoration: underline !important; }\n';
        }
        debug("Applying style [" + doc.documentElement + "]:" + css);

        // Iterate over all style elements for this document (one element for each
        // frame/iframe);
        for each (var style in browser._noSquintStyles)
            style.textContent = css;
    },


    /* Callback from custom ProgressListener when the given browser's URI 
     * has changed.
     */
    locationChanged: function(browser, uri) {
        var site = NoSquint.getSiteFromBrowser(browser);
        debug("locationChanged: from " + browser._noSquintSite + " to " + site + ", uri=" + uri.spec);
        if (site != browser._noSquintSite)
            // Site accessed; update timestamp on new site.
            NoSquint.updateSiteList(site, null, null, true);
        else if (!NoSquint.rememberSites)
            // We're in global mode and still on the same site, so do not
            // rezoom, allowing us to maintain any temporary user levels.
            return;

        browser._noSquintSite = site;
        NoSquint.zoom(browser);
        if (NoSquint.siteDialog && NoSquint.siteDialog.browser == browser)
            NoSquint.siteDialog.setValues(browser, site);
    },

    /* Called periodically (on startup, and once a day after that) in order to
     * remove remembered values for sites we haven't visited in forgetMonths.
     */
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
            debug("prune check: " + site + ", age=" + Math.round(age/1000/60/60/24) + " days, prune=" + prune);
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
        if (!browser._noSquintSite)
            // Nothing to save.  Chrome maybe.
            return;
        var text = Math.round(browser.markupDocumentViewer.textZoom * 100);
        var full = Math.round(browser.markupDocumentViewer.fullZoom * 100);
        debug("saveCurrentZoom: " + browser._noSquintSite);
        NoSquint.updateSiteList(browser, [text, full]);
    },

    /* Updates the site list for the given site name (or browser, from which
     * we'll grab the site name) to set the given levels (2-tuple of
     * [text, full]) and update_timestamp is a bool which, if true, will
     * cause the site's timestamp to be updated to the current time.
     *
     * Once updated, the site list is then queued for save in the prefs.
     */
    updateSiteList: function(site_or_browser, levels, style, update_timestamp) {
        if (!NoSquint.rememberSites)
            return;
        var site = site_or_browser;
        if (site_or_browser && typeof(site_or_browser) != "string")
            site = site_or_browser._noSquintSite;
        if (!site)
            return false;

        if (update_timestamp) {
            // When updating timestamp, levels == style == null.
            if (NoSquint.sites[site]) {
                NoSquint.sites[site][1] = new Date().getTime();
                NoSquint.sites[site][2] += 1;
                // XXX: do we bother saving site list here?  The overhead
                // probably isn't worth it just for a timestamp update.
            } 
            return true;
        }

        if (!NoSquint.sites[site])
            // new site record
            NoSquint.sites[site] = [0, new Date().getTime(), 1, 0, '0', '0', false, '0', '0', false];
        var record = NoSquint.sites[site];

        if (levels) {
            // Update record with specified levels.
            var [text_default, full_default] = NoSquint.getZoomDefaults();
            var [text, full] = levels;
            // Default zooms are stored as 0.
            record[0] = text == text_default ? 0 : text;
            record[3] = full == full_default ? 0 : full;
            NoSquint.queueZoomAll(site, 1000);
        }
        if (style) {
            record[4] = style.text;
            record[5] = style.bg;
            record[6] = style.bgimages;
            record[7] = style.unvisited;
            record[8] = style.visited;
            record[9] = style.underline;
            NoSquint.queueStyleAll(site, 1000);
        }

        // Check newly updated record against defaults.  If all values are default, we
        // remove the record.
        if ([record[0]].concat(record.slice(3)).toString() == [0, 0, '0', '0', false, '0', '0', false].toString())
            // All defaults.
            delete NoSquint.sites[site];

        debug("UPDATE SITE LIST: " + site + ": " + record);

        // Queue site list save.
        NoSquint.saveSiteList();
    },

    /* Queues a save of the site list in the prefs service.
     *
     * NOTE: This must only be called when the list has actually changed, or
     * else the next time a change is made in the Settings dialog, it will
     * be ignored.
     */
    saveSiteList: function() {
        if (NoSquint.saveTimer != null)
            // Restart timer
            clearTimeout(NoSquint.saveTimer);

        NoSquint.sitesDirty = true;
        /* The list is actually saved (by default) 5s later, so if the user
         * changes the zoom several times in a short period of time, we aren't
         * needlessly iterating over the sites array.
         */
        NoSquint.saveTimer = setTimeout(function() { NoSquint._realSaveSiteList(); }, NoSquint.saveDelay);
    },

    /* Actually store the sites list. */
    _realSaveSiteList: function(force) {
        if (NoSquint.observer.inPrivateBrowsing && !force)
            // Private Browsing mode is enabled; do not save site list.
            return;

        /* XXX: this can take up to 20ms (!!!) even with a smallish sites list
         * (about 50).  If it scales linearly or worse, this could be a
         * problem.  Need to do some more serious benchmarking here.  Looks
         * like setCharPref can trigger pref observer handlers synchronously,
         * so time elapsed includes the time the handlers take too.
         */
        var t0 = new Date().getTime();
        var sites = [];
        for (var site in NoSquint.sites) {
            if (!NoSquint.sites[site])
                continue;
            sites.push(site + "=" + NoSquint.sites[site].join(','));
        }

        /* We're modifying the sites pref here.  Setting ignoreNextSitesChange=true
         * causes the observer (in our current state) to not bother reparsing the
         * sites pref because we know it's current.  In other words, we needn't
         * respond to our own changes.
         */
        NoSquint.ignoreNextSitesChange = true;
        NoSquint.prefs.setCharPref("sites", sites.join(" "));
        debug("sites save took: " + (new Date().getTime() - t0) + "ms");
        clearTimeout(NoSquint.saveTimer);
        NoSquint.saveTimer = null;
        NoSquint.sitesDirty = false;
        debug("Full site list: " + sites);
    },

    /* Attach observers on extensions.nosquint and mousewheel.withcontrolkey
     * branches, and simulate a change to each of our prefs so that we can
     * load them.
     */
    initPrefs: function(populate) {
        if (NoSquint.prefs)
            // Prefs already initialized.
            return;

        var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(
                          Components.interfaces.nsIPrefService);
        NoSquint.prefs = prefs.getBranch("extensions.nosquint.");
        NoSquint.browserZoomPrefs = prefs.getBranch("browser.zoom.");

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

        if (NoSquint.prefs.getCharPref('prefsVersion') < '2.0') {
            try {
                // In 2.0, zoomlevel was split into fullZoomLevel and textZoomLevel
                var zoomlevel = NoSquint.prefs.getIntPref("zoomlevel");
                NoSquint.prefs.clearUserPref("zoomlevel");
            } catch (err) {
                // this was the default zoomlevel for < 2.0.
                var zoomlevel = 120;
            }

            /* Previous versions of NoSquint set mousewheel.withcontrolkey.action=0
             * under the assumption that we won't see DOMMouseScroll events otherwise.
             * This was true with Firefox < 3, but apparently no longer the case with
             * 3 and later.  So we restore the pref to its default value during this
             * initial migration.  (The user might not want it restored, but this is
             * the best we can do given what we know, and the correct thing to do
             * in the common case.)
             */
            var mousePrefs = prefs.getBranch("mousewheel.withcontrolkey.");
            mousePrefs.setIntPref("action", 3);

            var fullZoomPrimary = NoSquint.prefs.getBoolPref("fullZoomPrimary");
            if (fullZoomPrimary) {
                NoSquint.prefs.setIntPref("fullZoomLevel", zoomlevel);
                NoSquint.prefs.setIntPref("textZoomLevel", 100);
            } else {
                NoSquint.prefs.setIntPref("fullZoomLevel", 100);
                NoSquint.prefs.setIntPref("textZoomLevel", zoomlevel);
            }
            NoSquint.prefs.setCharPref('prefsVersion', '2.0');
        }

        /* Disable browser.zoom.siteSpecific, which prevents Firefox from
         * automatically applying zoom levels, as that is no NoSquint's job.
         */
        NoSquint.origSiteSpecific = NoSquint.browserZoomPrefs.getBoolPref('siteSpecific');
        NoSquint.browserZoomPrefs.setBoolPref("siteSpecific", false);

        if (populate) {
            var prefs = [
                "fullZoomLevel", "textZoomLevel", "zoomIncrement", "wheelZoomEnabled", "hideStatus",
                "action", "sitesSaveDelay", "rememberSites", "exceptions", "sites", "forgetMonths",
                "fullZoomPrimary", "wheelZoomInvert", "zoomImages", "colorText", "colorBackground", 
                "colorBackgroundImages", "linksUnvisited", "linksVisited", "linksUnderline"
            ];
            for each (var pref in prefs)
                // Simulate pref change for each pref to populate attributes
                NoSquint.observe(null, "nsPref:changed", pref);
        }
        
        // Attach observers to both branches.
        NoSquint.prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
        NoSquint.prefs.addObserver("", NoSquint, false);
        NoSquint.browserZoomPrefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
        NoSquint.browserZoomPrefs.addObserver("", NoSquint, false);
    },

    /* Callback from prefs observer when a pref has changed in one of the
     * branches we are watching.
     */
    observe: function(subject, topic, data) {
        if (topic != "nsPref:changed" || typeof(NoSquint) == 'undefined' || !NoSquint.prefs)
            // Either not a pref change, or we are in the process of shutting down.
            return;

        switch (data) {
            case "siteSpecific":
                if (NoSquint.browserZoomPrefs.getBoolPref("siteSpecific") == false ||
                    window_get_global('disabled'))
                    // disabled, which is fine with us, so ignore.
                    break;

                // yes == 0, no or close == 1
                if (popup('confirm', 'siteSpecificTitle', 'siteSpecificPrompt') == 1)
                    popup('alert', 'siteSpecificBrokenTitle', 'siteSpecificBrokenPrompt');
                else
                    NoSquint.browserZoomPrefs.setBoolPref("siteSpecific", false);
                break;

            case "fullZoomLevel":
                NoSquint.defaultFullZoomLevel = NoSquint.prefs.getIntPref("fullZoomLevel");
                NoSquint.queueZoomAll();
                break;

            case "textZoomLevel":
                NoSquint.defaultTextZoomLevel = NoSquint.prefs.getIntPref("textZoomLevel");
                NoSquint.queueZoomAll();
                break;

            case "wheelZoomEnabled":
                NoSquint.wheelZoomEnabled = NoSquint.prefs.getBoolPref("wheelZoomEnabled");
                break;

            case "wheelZoomInvert":
                NoSquint.wheelZoomInvert = NoSquint.prefs.getBoolPref("wheelZoomInvert");
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

            case "zoomImages":
                NoSquint.zoomImages = NoSquint.prefs.getBoolPref("zoomImages");
                break;

            case "hideStatus":
                NoSquint.hideStatus = NoSquint.prefs.getBoolPref("hideStatus");
                document.getElementById("nosquint-status").hidden = NoSquint.hideStatus;
                if (!NoSquint.hideStatus)
                    NoSquint.handleTabChanged();
                break;

            case "rememberSites":
                NoSquint.rememberSites = NoSquint.prefs.getBoolPref("rememberSites");
                // XXX: if false, should we clear sites?
                NoSquint.queueZoomAll();
                break;

            case "sitesSaveDelay":
                NoSquint.saveDelay = NoSquint.prefs.getIntPref("sitesSaveDelay");
                break;

            case "exceptions":
                // Parse exceptions list from prefs
                var exlist = NoSquint.prefs.getCharPref("exceptions").replace(/(^\s+|\s+$)/g, "").split(" ");
                NoSquint.exceptions = NoSquint.processExceptions(exlist);
                NoSquint.queueZoomAll();
                break;

            case "sites":
                if (NoSquint.ignoreNextSitesChange) {
                    NoSquint.ignoreNextSitesChange = false;
                    break;
                }
                NoSquint.parseSitesPref();
                NoSquint.queueZoomAll();
                NoSquint.queueStyleAll();
                break;

            case "colorText":
                NoSquint.colorText = NoSquint.prefs.getCharPref("colorText");
                NoSquint.queueStyleAll();
                break;

            case "colorBackground":
                NoSquint.colorBackground = NoSquint.prefs.getCharPref("colorBackground");
                NoSquint.queueStyleAll();
                break;

            case "colorBackgroundImages":
                NoSquint.colorBackgroundImages = NoSquint.prefs.getBoolPref("colorBackgroundImages");
                NoSquint.queueStyleAll();
                break;

            case "linksUnvisited":
                NoSquint.linksUnvisited = NoSquint.prefs.getCharPref("linksUnvisited");
                NoSquint.queueStyleAll();
                break;

            case "linksVisited":
                NoSquint.linksVisited = NoSquint.prefs.getCharPref("linksVisited");
                NoSquint.queueStyleAll();
                break;

            case "linksUnderline":
                NoSquint.linksUnderline = NoSquint.prefs.getBoolPref("linksUnderline");
                NoSquint.queueStyleAll();
                break;
            }
    },

    /* Parses extensions.nosquint.sites pref into NoSquint.sites array.
     */
    parseSitesPref: function() {
        /* Parse site list from prefs.  The prefs string a list of site specs, delimited by a space, in the
         * form: 
         *
         *     sitename=text_level,timestamp,visits,full_level
         *
         * Spaces are not allowed in any value; sitename is a string, all other values are integers.  The
         * parsing code tries to be robust and handle malformed entries gracefully (in case the user edits
         * them manually and screws up).  Consequently it is ugly.
         */
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
            NoSquint.sites[site] = [parseInt(parts[0]) || 0, now, 1, 0, '0', '0', false, '0', '0', false];
            if (parts.length > 1) // last visited timestamp
                NoSquint.sites[site][1] = parseInt(parts[1]) || now;
            if (parts.length > 2) // visit count
                NoSquint.sites[site][2] = parseInt(parts[2]) || 1;
            if (parts.length > 3) // full page zoom level
                NoSquint.sites[site][3] = parseInt(parts[3]) || 0;
            if (parts.length > 4) // text color
                NoSquint.sites[site][4] = parts[4] || '0';
            if (parts.length > 5) // bg color
                NoSquint.sites[site][5] = parts[5] || '0';
            if (parts.length > 6) // disable bg images
                NoSquint.sites[site][6] = parts[6] == 'true' ? true : false;
            if (parts.length > 7) // unvisited link color
                NoSquint.sites[site][7] = parts[7] || '0';
            if (parts.length > 8) // visited link color
                NoSquint.sites[site][8] = parts[8] || '0';
            if (parts.length > 9) // force underline links
                NoSquint.sites[site][9] = parts[9] == 'true' ? true : false;

        }
        if (NoSquint.sitesDirty) {
            /* FIXME: looks like the sites list pref was updated (possibly by
             * another browser window) before we got a chance to write out our
             * changes.  We have lost them now; we should try to merge only
             * newer changes based on timestamp.
             */
            NoSquint.sitesDirty = false;
        }
    },

    /* Removes all site settings for sites that were modified within the given
     * range.  range is a 2-tuple (start, stop) where each are timestamps in
     * milliseconds.  The newly sanitized site list is then immediately stored.
     */
    sanitize: function(range) {
        if (range == undefined || !range) {
            NoSquint.sites = {}
        } else {
            for (var site in NoSquint.sites) {
                var timestamp = NoSquint.sites[site][1] * 1000;
                if (timestamp >= range[0] && timestamp <= range[1])
                    delete NoSquint.sites[site];
            }
        }
        NoSquint._realSaveSiteList();
        NoSquint.queueZoomAll();
        NoSquint.queueStyleAll();
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
    // This is called when it's confirmed a URL is loading (including reload).
    debug("Location change: " + uri.spec);
    this.style_applied = false;
    this.browser._noSquintStyles = [];
    this.content_type = this.browser.docShell.document.contentType;
    NoSquint.locationChanged(this.browser, this.browser.currentURI);
}

ProgressListener.prototype.onStateChange = function(progress, request, state, astatus) {
    //debug("LISTENER: request=" + request + ", state=" + state + ", status=" + astatus);
    //debug("STATE CHANGE: " + this.browser.docShell.document.contentType);
    //test for bf: state & Components.interfaces.nsIWebProgressListener.STATE_RESTORING

    /* Check the current content type against the content type we initially got.
     * This changes in the case when there's an error page (e.g. dns failure),
     * which we treat as chrome and do not adjust.
     */
    var content_type = this.browser.docShell.document.contentType;
    if (this.content_type != content_type) {
        this.content_type = content_type;
        if (is_chrome(this.browser)) {
            this.browser._noSquintSite = null;
            NoSquint.zoom(this.browser, 100, 100);
        }
    } else if (!this.style_applied && state & Components.interfaces.nsIWebProgressListener.STATE_STOP) {
        if (!is_chrome(this.browser) || is_image(this.browser))
            NoSquint.style(this.browser);
        this.style_applied = true;
    }
    if (!progress.isLoadingDocument) {
        // Document load is done; queue a save of the site list if it has been
        // changed.
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

// Custom observer attached to nsIObserverService.  Used to detect changes
// to private browsing state, and addon disable/uninstall.  Some code
// borrowed from https://developer.mozilla.org/En/Supporting_private_browsing_mode

function NoSquintObserver() {  
  this.init();  
}

NoSquintObserver.prototype = {  
    _os: null,  
    _inPrivateBrowsing: false, // whether we are in private browsing mode  
    watcher: {}, // the watcher object  
    _hooked: false,
   
    init: function () {  
        this._inited = true;  
        this._os = Components.classes["@mozilla.org/observer-service;1"]  
                             .getService(Components.interfaces.nsIObserverService);  
        this._hook();
    },

    _hook: function() {
        this._os.addObserver(this, "private-browsing-granted", false);  
        this._os.addObserver(this, "quit-application", false);  
        this._os.addObserver(this, "em-action-requested", false);  
        try {  
            var pbs = Components.classes["@mozilla.org/privatebrowsing;1"]  
                              .getService(Components.interfaces.nsIPrivateBrowsingService);  
            this._inPrivateBrowsing = pbs.privateBrowsingEnabled;  
        } catch(ex) {  
            // ignore exceptions in older versions of Firefox  
        }
        this._hooked = true;
    },

    _unhook: function() {
        this._os.removeObserver(this, "quit-application-granted");  
        this._os.removeObserver(this, "private-browsing");  
        this._hooked = false;
    },

    observe: function (subject, topic, data) {  
        debug("OBSERVER: sub=" + subject + ", topic=" + topic + ", data=" + data);
        switch (topic) {
            case "private-browsing":
                switch (data) {
                    case "enter":
                        this._inPrivateBrowsing = true;  
                        if ("onEnterPrivateBrowsing" in this.watcher)
                            this.watcher.onEnterPrivateBrowsing();  
                        break;

                    case "exit":
                        this._inPrivateBrowsing = false;  
                        if ("onExitPrivateBrowsing" in this.watcher)
                            this.watcher.onExitPrivateBrowsing();  
                        break;
                }
                break;

            case "quit-application-granted":
                this._unhook();
                break;

            case "em-action-requested":
                switch (data) {
                    case "item-disabled":
                    case "item-uninstalled":
                        var item = subject.QueryInterface(Components.interfaces.nsIUpdateItem);
                        if (item.id != 'nosquint@urandom.ca' || window_get_global('disabled'))
                            break;

                        window_set_global('disabled', true);
                        if (popup('confirm', 'disableTitle', 'disablePrompt') == 1) {
                            // Clicked no
                        } else {
                            NoSquint.browserZoomPrefs.setBoolPref("siteSpecific", true);
                        }
                        debug("Disabling item: " + item.id);
                        break;
                    
                    case "item-cancel-action":
                        var item = subject.QueryInterface(Components.interfaces.nsIUpdateItem);
                        if (item.id != 'nosquint@urandom.ca' || window_get_global('disabled') != true)
                            break;
                        NoSquint.browserZoomPrefs.setBoolPref("siteSpecific", false);
                        debug("Enabling item: " + item.id);
                        window_set_global('disabled', false);
                }
                break;
        }
    },  
   
    get inPrivateBrowsing() {  
        return this._inPrivateBrowsing;  
    },  
}; 
