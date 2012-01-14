// chrome://browser/content/browser.xul

/******************************************************************************
 * Preferences (Singleton)
 *
 * Namespace for anything pref related, including service objects, any
 * currently cached values, routines for parsing, or convenience functions
 * for accessing preferences.
 */

NoSquint.prefs = NoSquint.ns(function() { with(NoSquint) {
    // Namespace is a singleton, so return any previously instantiated prefs object.
    if (NSQ.storage.prefs)
        return NSQ.storage.prefs;
    NSQ.storage.prefs = this;

    this.id = 'NoSquint.prefs';
    this.defaultColors = {
        colorText: '#000000',
        colorBackground: '#ffffff',
        linksUnvisited: '#0000ee',
        linksVisited: '#551a8b'
    };

    /* Active window we can use for window methods (e.g. setTimeout).  Because
     * NSQ.prefs is a singleton, it could be that the window we initialized
     * with has been closed.  In that case, setTimeout will fail with 
     * NS_ERROR_NOT_INITIALIZED.  So we keep a reference to an available
     * window here we can call window.* methods with, and if the window
     * goes away, we find a new one using foreachNSQ().
     */
    this.window = window;

    // Pref service.
    var svc = Components.classes["@mozilla.org/preferences-service;1"].getService(
                          Components.interfaces.nsIPrefService);
    svc.QueryInterface(Components.interfaces.nsIPrefBranch);
    this.svc = svc;

    // Pref Branches we're interested in.
    var branchNS = svc.getBranch('extensions.nosquint.');
    var branchBZ = svc.getBranch('browser.zoom.');

    var saveTimer = null;                // Timer for saveSiteList
    var pruneTimer = null;               // Timer for pruneSites
    var ignoreNextSitesChange = false;   // Ignore next update to sites pref
    var origSiteSpecific = null;         // Original value of browser.zoom.siteSpecific
    var initialized = false;


    this.init = function() {
        if (initialized)
            return;
        initialized = true;

        // Backward compatibility: convert old prefs.
        if (branchNS.getCharPref('prefsVersion') < '2.0') {
            try {
                // In 2.0, zoomlevel was split into fullZoomLevel and textZoomLevel
                var zoomlevel = branchNS.getIntPref('zoomlevel');
                branchNS.clearUserPref('zoomlevel');
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
            svc.setIntPref('mousewheel.withcontrolkey.action', 3);

            var fullZoomPrimary = branchNS.getBoolPref('fullZoomPrimary');
            if (fullZoomPrimary) {
                branchNS.setIntPref('fullZoomLevel', zoomlevel);
                branchNS.setIntPref('textZoomLevel', 100);
            } else {
                branchNS.setIntPref('fullZoomLevel', 100);
                branchNS.setIntPref('textZoomLevel', zoomlevel);
            }
            branchNS.setCharPref('prefsVersion', '2.0');
        }

        /* Disable browser.zoom.siteSpecific, which prevents Firefox from
         * automatically applying zoom levels, as that is now NoSquint's job.
         */
        if (origSiteSpecific === null)
            origSiteSpecific = branchBZ.getBoolPref('siteSpecific');
        this.setSiteSpecific(false);

        // Pull prefs from prefs branch into object attributes
        this.preload();

        // Attach observers to both branches.
        branchNS.QueryInterface(Components.interfaces.nsIPrefBranch2);
        branchNS.addObserver('', this, false);
        branchBZ.QueryInterface(Components.interfaces.nsIPrefBranch2);
        branchBZ.addObserver('', this, false);
    };

    this.destroy = function() {
        if (this.rememberSites)
            // In case the window shutting down is the one whose saveTimer is
            // associated with, we should finish any pending save now.
            this.finishPendingSaveSiteList();

        if (!NSQ.storage.quitting)
            // NSQ.prefs is a singleton so we only ever truly destroy on app
            // shutdown.
            return;

        branchNS.removeObserver('', this);
        branchBZ.removeObserver('', this);

        if (!this.rememberSites)
            // Per-site setting storage disabled.
            branchNS.setCharPref('sites', '');

        this.setSiteSpecific(origSiteSpecific);
    };


    /* Invoke a window method, such as setTimeout.  We need to do this indirectly
     * because NSQ.prefs is a singleton, and the window NSQ.prefs initialized with
     * may not actually still be alive.
     */
    this.winFunc = function(func) {
        var args = Array.prototype.slice.call(arguments, 1); 
        try {
            return this.window[func].apply(this.window, args);
        } catch (e) {
            // Presumably NS_ERROR_NOT_INITIALIZED.  TODO: verify.
            this.window = foreachNSQ(function() false);
            return this.window[func].apply(this.window, args);
        }
    };

    this.setSiteSpecific = function(value) {
        branchBZ.setBoolPref('siteSpecific', value);
        this.save();
    };

    this.preload = function() {
        // Initialize preferences in this order; some of them require other prefs
        // have been loaded.  (e.g. forgetMonths needs rememberSites)
        var prefs = [
            'fullZoomLevel', 'textZoomLevel', 'zoomIncrement', 'wheelZoomEnabled', 'hideStatus',
            'action', 'sitesSaveDelay', 'rememberSites', 'exceptions', 'sites', 'forgetMonths',
            'fullZoomPrimary', 'wheelZoomInvert', 'zoomImages', 'colorText', 'colorBackground', 
            'colorBackgroundImages', 'linksUnvisited', 'linksVisited', 'linksUnderline'
        ];
        for (let pref in iter(prefs))
            // Simulate pref change for each pref to populate attributes
            this.observe(null, "nsPref:changed", pref);
    };


    this.observe = function(subject, topic, data) {
        if (topic != "nsPref:changed")
            // Not a pref change.
            return;

        debug('observe(): data=' + data);
        switch (data) {
            case 'siteSpecific':
                if (branchBZ.getBoolPref('siteSpecific') == false || NSQ.storage.disabled || NSQ.storage.quitting)
                    // disabled, which is fine with us, so ignore.
                    break;

                // yes == 0, no or close == 1
                if (popup('confirm', NSQ.strings.siteSpecificTitle, NSQ.strings.siteSpecificPrompt) == 1)
                    popup('alert', NSQ.strings.siteSpecificBrokenTitle, NSQ.strings.siteSpecificBrokenPrompt);
                else
                    this.setSiteSpecific(false);
                break;

            case 'fullZoomLevel':
                this.fullZoomLevel = branchNS.getIntPref('fullZoomLevel');
                foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueZoomAll() : null);
                break;

            case 'textZoomLevel':
                this.textZoomLevel = branchNS.getIntPref('textZoomLevel');
                foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueZoomAll() : null);
                break;

            case 'wheelZoomEnabled':
                this.wheelZoomEnabled = branchNS.getBoolPref('wheelZoomEnabled');
                break;

            case 'wheelZoomInvert':
                this.wheelZoomInvert = branchNS.getBoolPref('wheelZoomInvert');
                break;

            case 'zoomIncrement':
                this.zoomIncrement = branchNS.getIntPref('zoomIncrement');
                break;

            case 'forgetMonths':
                this.forgetMonths = branchNS.getIntPref('forgetMonths');
                this.pruneSites();
                break;

            case 'fullZoomPrimary':
                this.fullZoomPrimary = branchNS.getBoolPref('fullZoomPrimary');
                foreachNSQ(function(NSQ) {
                    if (NSQ.browser) {
                        NSQ.browser.updateZoomMenu();
                        NSQ.browser.queueZoomAll();
                    }
                });
                break;

            case 'zoomImages':
                this.zoomImages = branchNS.getBoolPref('zoomImages');
                break;

            case 'hideStatus':
                var hideStatus = branchNS.getBoolPref('hideStatus');
                this.hideStatus = hideStatus;
                foreachNSQ(function(NSQ) {
                    if (NSQ.browser) {
                        $('nosquint-status').hidden = hideStatus;
                        if (!hideStatus)
                            // Status now being shown; update it to reflect current values.
                            NSQ.browser.queueUpdateStatus();
                    }
                });
                break;

            case 'rememberSites':
                this.rememberSites = branchNS.getBoolPref('rememberSites');
                if (NSQ.storage.dialogs.site)
                    // Toggle the warning in sites dialog.
                    NSQ.storage.dialogs.site.updateWarning();
                // TODO: if false, remove stored sites settings immediately, but keep
                // in memory until end of session.
                break;

            case 'sitesSaveDelay':
                this.saveDelay = branchNS.getIntPref('sitesSaveDelay');
                break;

            case 'exceptions':
                // Parse exceptions list from prefs
                this.exceptions = this.parseExceptions(branchNS.getCharPref('exceptions'));
                foreachNSQ(function(NSQ) {
                    if (NSQ.browser) {
                        NSQ.browser.updateZoomMenu();
                        NSQ.browser.queueZoomAll();
                    }
                });
                break;

            case 'sites':
                if (ignoreNextSitesChange) {
                    ignoreNextSitesChange = false;
                    break;
                }
                this.sites = this.parseSites(branchNS.getCharPref('sites'));
                if (saveTimer) {
                    /* FIXME: looks like the sites list pref was updated (possibly by
                     * another browser window) before we got a chance to write out our
                     * changes.  We have lost them now; we should try to merge only
                     * newer changes based on timestamp.
                     */
                     this.stopQueueSaveSiteList();
                }
                foreachNSQ(function(NSQ) {
                    if (NSQ.browser) {
                        NSQ.browser.queueZoomAll();
                        NSQ.browser.queueStyleAll();
                    }
                });
                break;

            case 'colorText':
                this.colorText = branchNS.getCharPref('colorText');
                foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueStyleAll() : null);
                break;

            case 'colorBackground':
                this.colorBackground = branchNS.getCharPref('colorBackground');
                foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueStyleAll() : null);
                break;

            case 'colorBackgroundImages':
                this.colorBackgroundImages = branchNS.getBoolPref('colorBackgroundImages');
                foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueStyleAll() : null);
                break;

            case 'linksUnvisited':
                this.linksUnvisited = branchNS.getCharPref('linksUnvisited');
                foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueStyleAll() : null);
                break;

            case 'linksVisited':
                this.linksVisited = branchNS.getCharPref('linksVisited');
                foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueStyleAll() : null);
                break;

            case 'linksUnderline':
                this.linksUnderline = branchNS.getBoolPref('linksUnderline');
                foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueStyleAll() : null);
                break;
        }
    };

    this.save = function() {
        return svc.savePrefFile(null);
    };


    /* Parses a extensions.nosquint.sites pref into sites array.
     */
    this.parseSites = function(sitesStr) {
        /* Parse site list from prefs.  The prefs string a list of site specs,
         * delimited by a space, in the form: 
         *
         *     sitename=text_level,timestamp,visits,full_level,textcolor,bgcolor,
         *              nobgimages,linkunvis,linkvis,linkunderline
         *
         * Spaces are not allowed in any value; sitename is a string, all other
         * values are integers.  The parsing code tries to be robust and handle
         * malformed entries gracefully (in case the user edits them manually
         * and screws up).  Consequently it is ugly.
         */
        var sites = {};
        // Trim whitespace and split on space.
        var sitesList = sitesStr.replace(/(^\s+|\s+$)/g, '').split(' ');
        var now = new Date().getTime();

        for (let defn in iter(sitesList)) {
            var parts = defn.split('=');
            if (parts.length != 2)
                continue; // malformed
            var [site, info] = parts;
            var parts = info.split(',');
            sites[site] = [parseInt(parts[0]) || 0, now, 1, 0, '0', '0', false, '0', '0', false];
            if (parts.length > 1) // last visited timestamp
                sites[site][1] = parseInt(parts[1]) || now;
            if (parts.length > 2) // visit count
                sites[site][2] = parseInt(parts[2]) || 1;
            if (parts.length > 3) // full page zoom level
                sites[site][3] = parseInt(parts[3]) || 0;
            if (parts.length > 4) // text color
                sites[site][4] = parts[4] || '0';
            if (parts.length > 5) // bg color
                sites[site][5] = parts[5] || '0';
            if (parts.length > 6) // disable bg images
                sites[site][6] = parts[6] == 'true' ? true : false;
            if (parts.length > 7) // unvisited link color
                sites[site][7] = parts[7] || '0';
            if (parts.length > 8) // visited link color
                sites[site][8] = parts[8] || '0';
            if (parts.length > 9) // force underline links
                sites[site][9] = parts[9] == 'true' ? true : false;

        }
        return sites;
    };


    /* Takes an array of exceptions as stored in prefs, and returns a sorted
     * list, where each exception is converted to a regexp grammar.  The list
     * is sorted such that exceptions with the most literal (non-wildcard)
     * characters are first.
     */
    this.parseExceptions = function(exStr) {
        // Trim the space-delimited exceptions string and convert to array.
        var exlist = exStr.replace(/(^\s+|\s+$)/g, '').split(' ');

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

            var group = 1;
            for (let part in iter(parts)) {
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
                    sub.push('$' + group++);
            }
            return [length, pattern.join(''), sub.join('')];
        }

        var exceptions = [];
        for (var origexc in iter(exlist)) {
            if (!origexc)
                continue;
            // Escape metacharacters except *
            exc = origexc.replace(/([^\w:*\[\]])/g, '\\$1');
            // Split into host and path parts, and regexpify separately.
            var [_, exc_host, exc_path] = exc.match(/([^\/]*)(\\\/.*|$)/);
            var [len_host, re_host, sub_host] = regexpify(exc_host, '[^.:/]+', '.*');
            var [len_path, re_path, sub_path] = regexpify(exc_path, '[^/]+', '.*');
            if (exc_host.search(':') == -1)
                re_host += '(:\\d+)';

            debug("regexpify(): exc_host=" + exc_host + ", re_host=" + re_host + ", sub_host=" + sub_host + ", exc_path=" + exc_path + ", re_path=" + re_path + ", sub_path=" + sub_path);
            exceptions.push([origexc, len_host * 1000 + len_path, exc_host, re_host, sub_host, re_path, sub_path]);
        }
        // Sort the exceptions such that the ones with the highest weights
        // (that is, the longest literal lengths) appear first.
        exceptions.sort(function(a, b) b[1] - a[1]);
        return exceptions;
    };


    /* Called periodically (on startup, and once a day after that) in order to
     * remove remembered values for sites we haven't visited in forgetMonths.
     */
    this.pruneSites = function()  {
        if (!this.rememberSites || this.forgetMonths == 0)
            return;
    
        var remove = [];
        var now = new Date();
        for (let [site, settings] in items(this.sites)) {
            if (!settings)
                continue
            var [text, timestamp, counter, full] = settings;
            var age = now - new Date(timestamp);
            var prune = (age > this.forgetMonths * 30*24*60*60*1000);
            if (prune)
                remove.push(site);
            debug("pruneSites(): site=" + site + ", age=" + Math.round(age/1000/60/60/24) + " days, prune=" + prune);
        }
        if (remove.length) {
            for (let site in iter(remove))
                delete this.sites[site];
            this.queueSaveSiteList();
        }

        // Fire timer once a day.
        if (pruneTimer == null)
            pruneTimer = this.winFunc('setTimeout', function() { pruneTimer = null; NSQ.prefs.pruneSites(); }, 24*60*60*1000);
    };


    /* Updates the site list for the given site name to set the given levels
     * (2-tuple of [text, full]), and then queues a site list save.
     */
    this.updateSiteList = function(site, levels, style, update_timestamp) {
        if (!site)
            return;

        if (!this.sites[site])
            // new site record, initialize to defaults.
            this.sites[site] = [0, new Date().getTime(), 1, 0, '0', '0', false, '0', '0', false];
        var record = this.sites[site];

        if (levels) {
            // Update record with specified levels.
            var [text_default, full_default] = this.getZoomDefaults();
            var [text, full] = levels;
            // Default zooms are stored as 0.
            record[0] = text == text_default ? 0 : text;
            record[3] = full == full_default ? 0 : full;
            // Update all other tabs for this site.
            foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueZoomAll(site, 1000) : null);
        }
        if (style) {
            record[4] = style.colorText || '0';
            record[5] = style.colorBackground || '0';
            record[6] = style.colorBackgroundImages || '0';
            record[7] = style.linksUnvisited || '0';
            record[8] = style.linksVisited || '0';
            record[9] = style.linksUnderline || '0';
            // Update all other tabs for this site.
            foreachNSQ(function(NSQ) NSQ.browser ? NSQ.browser.queueStyleAll(site, 1000) : null);
        }

        // Check newly updated record against defaults.  If all values are default, we
        // remove the record.
        if ([record[0]].concat(record.slice(3)).toString() == [0, 0, '0', '0', false, '0', '0', false].toString())
            // All defaults.
            delete this.sites[site];

        debug('updateSiteList(): site=' + site + ', record=' + record);

        if (this.rememberSites)
            this.queueSaveSiteList();
    };


    /* Updates the last-accessed timestamp for the given site, and then
     * queues a site list save.
     */
    this.updateSiteTimestamp = function(site) {
        if (!site || !this.sites[site])
            return;

        this.sites[site][1] = new Date().getTime();
        this.sites[site][2] += 1;
        if (this.rememberSites)
            // Save updated timestamp.  Timestamps are only updated on
            // the first page accessed for a given visit to that site,
            // so this shouldn't be too bad.
            this.queueSaveSiteList();
    };


    /* Queues a save of the site list in the prefs service.
     *
     * NOTE: This must only be called when the list has actually changed, or
     * else the next time a change is made in the Settings dialog, it will
     * be ignored.
     */
    this.queueSaveSiteList = function() {
        this.stopQueueSaveSiteList();

        /* The list is actually saved (by default) 5s later, so if the user
         * changes the zoom several times in a short period of time, we aren't
         * needlessly iterating over the sites array.
         */
        debug("queueSaveSiteList(): delay=" + this.saveDelay + ', window=' + window);
        saveTimer = this.winFunc('setTimeout', function() NSQ.prefs.saveSiteList(), this.saveDelay);
    };


    /* Store the sites list right now. */
    this.saveSiteList = function(force) {
        if (!this.rememberSites || (NSQ.browser && NSQ.browser.observer.inPrivateBrowsing && !force))
            /* Private Browsing mode is enabled or rememberSites disabled; do
             * not save site list.
             */
            return;
        var t0 = new Date().getTime();
        var sites = [];
        for (let [site, settings] in items(this.sites)) {
            if (!settings)
                continue;
            sites.push(site + "=" + settings.join(','));
        }

        /* We're modifying the sites pref here.  Setting ignoreNextSitesChange=true
         * causes the observer (in our current state) to not bother reparsing the
         * sites pref because we know it's current.  In other words, we needn't
         * respond to our own changes.
         */
        ignoreNextSitesChange = true;
        branchNS.setCharPref('sites', sites.join(' '));
        this.save();
        debug("saveSiteList(): took: " + (new Date().getTime() - t0) + "ms");
        this.winFunc('clearTimeout', saveTimer);
        saveTimer = null;
    };


    /* Stops a previously queued site list save.  Returns true if a save was
     * queued and aborted, or false if no save was queued.
     */
    this.stopQueueSaveSiteList = function() {
        if (saveTimer === null)
            return false;

        this.winFunc('clearTimeout', saveTimer);
        saveTimer = null;
        return true;
    };

    /* If a site list save is queued, force it to happen now.
     */
    this.finishPendingSaveSiteList = function() {
        if (saveTimer)
            this.saveSiteList();
    };

    this.cloneSites = function() {
        var sites = {};
        for (let [site, values] in Iterator(this.sites))
            sites[site] = values.slice();
        return sites;
    };

    /* Returns a 2-tuple [text_default, full_default] representing the default
     * zoom levels.
     */
    this.getZoomDefaults = function() {
        return [this.textZoomLevel, this.fullZoomLevel];
    };


    /* Given a URI, returns the site name, as computed based on user-defined
     * exceptions.  If no exception matches the URI, we fall back to the base
     * domain name.
     */
    this.getSiteFromURI = function(URI) {
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

        var base = getBaseDomainFromHost(uri_host);
        if (!base && !uri_host)
            // file:// url, use base as /
            base = '/';

        uri_host += ':' + uri_port;

        var match = null;
        
        /* Iterate over each exception, trying to match it with the URI.
         * We break the loop on the first match, because exceptions are
         * sorted with highest weights first.
         */
        for (let exc in iter(this.exceptions)) {
            var [_, weight, exc_host, re_host, sub_host, re_path, sub_path] = exc;
            if (re_host.substr(0, 11) == '([^.:/]+)(:') // exc_host == *[:...]
                // Single star is base name, so match just that, plus any port spec
                // that's part of the exception.
                re_host = '(' + base + ')' + re_host.substr(9);

            var m1 = uri_host.match(new RegExp('(' + re_host + ')$'));
            var m2 = uri_path.match(new RegExp('^(' + re_path + ')'));

            //debug("getSiteFromURI(): host=" + uri_host + ", port=" + uri_port+ ", path=" + uri_path + ", base=" + base + " === exception info: re_host=" + re_host + ", sub_host=" + sub_host + ", re_path=" + re_path + ", sub_path=" + sub_path + " === results: m1=" + m1 + ", m2=" + m2);

            if (!m1 || !m2)
                // No match
                continue;

            var site_host = m1[1].replace(new RegExp(re_host), sub_host);
            var site_path = m2[1].replace(new RegExp(re_path), sub_path);
            match = site_host + site_path;
            break;
        }
        var t1 = new Date().getTime();
        debug("getSiteFromURI(): took " + (t1-t0) + " ms: " + (match ? match : base) + ", uri=" + URI.spec);

        return match ? match : base;
    };


    /* Gets the zoom levels for the given site name.  (Note, this is the site
     * name as gotten from getSiteFromURI(), not the URI itself.)  Returns a
     * 2-tuple [text_size, full_size], or [null, null] if the site is not
     * found.  (This signifies to the caller to use the default zoom.)
     */
    this.getZoomForSite = function(site) {
        if (site && this.sites[site])
            return [this.sites[site][0], this.sites[site][3]];
        return [null, null];
    };

    /* Gets the style parameters for the given site name.  Returns null if
     * the site has no settings.
     */
    this.getStyleForSite = function(site) {
       if (site && this.sites[site]) {
            var s = this.sites[site];
            return {
                colorText: s[4],
                colorBackground: s[5],
                colorBackgroundImages: s[6],
                linksUnvisited: s[7],
                linksVisited: s[8],
                linksUnderline: s[9]
            };
        }
        return null;
    };

    /* Applies global styles to the given style object.  Attributes that have
     * no site-local or global value are null.
     */
    this.applyStyleGlobals = function(style) {
        var newstyle = { enabled: false };
        var boolDefaults = {colorBackgroundImages: false, linksUnderline: false};
        var isDefault = function(o, attr) !o || !o[attr] || o[attr] in ['0', false];
        for (let [key, value] in items(this.defaultColors, boolDefaults)) {
            newstyle[key] = isDefault(style, key) ? (isDefault(this, key) ? null : this[key]) : style[key];
            newstyle.enabled = newstyle.enabled || Boolean(newstyle[key]);
        }
        return newstyle;
    };


    // Saves all preferences, including exceptions BUT NOT sites.
    this.saveAll = function(exceptions) {
        const intPrefs = [
            'fullZoomLevel', 'textZoomLevel', 'zoomIncrement', 'forgetMonths'
        ];
        const boolPrefs = [
            'wheelZoomEnabled', 'wheelZoomInvert', 'fullZoomPrimary', 'zoomImages',
            'hideStatus', 'rememberSites', 'colorBackgroundImages', 'linksUnderline'
        ];
        const charPrefs = [
            'colorText', 'colorBackground', 'linksUnvisited', 'linksVisited'
        ];

        for (let pref in iter(intPrefs))
            branchNS.setIntPref(pref, this[pref]);

        for (let pref in iter(boolPrefs))
            branchNS.setBoolPref(pref, this[pref]);

        for (let pref in iter(charPrefs))
            branchNS.setCharPref(pref, this[pref]);

        var exChanged = false;
        if (exceptions) {
            // TODO: if there is a new exception that matches any currently open
            // tab, copy site settings for that tab into the new site name.  Also,
            // any open site prefs dialog should be updated.
            var exStr = exceptions.join(' ');
            if (exStr != branchNS.getCharPref('exceptions')) {
                branchNS.setCharPref('exceptions', exStr);
                this.exceptions = this.parseExceptions(exStr);
                exChanged = true;
            }
        }

        foreachNSQ(function(NSQ) {
            if (!NSQ.browser)
                return;
            if (exChanged) {
                // exceptions changed, site names may have changed, so regenerate
                // site names for all browsers.
                for (let browser in iter(NSQ.browser.gBrowser.browsers))
                    browser.getUserData('nosquint').site = NSQ.browser.getSiteFromBrowser(browser);
            }
            NSQ.browser.queueZoomAll();
            NSQ.browser.queueStyleAll();
        });
    };

    /* Removes all site settings for sites that were modified within the given
     * range.  range is a 2-tuple (start, stop) where each are timestamps in
     * milliseconds.  The newly sanitized site list is then immediately stored.
     * All browsers are updated to reflect any changes.
     */
    this.sanitize = function(range) {
        if (range == undefined || !range) {
            this.sites = {}
        } else {
            for (var site in this.sites) {
                var timestamp = this.sites[site][1] * 1000;
                if (timestamp >= range[0] && timestamp <= range[1])
                    delete this.sites[site];
            }
        }
        this.saveSiteList();
        foreachNSQ(function(NSQ) {
            if (NSQ.browser) {
                NSQ.browser.queueZoomAll();
                NSQ.browser.queueStyleAll();
            }
        });
    };
}});
