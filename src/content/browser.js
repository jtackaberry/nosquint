// chrome://browser/content/browser.xul

/******************************************************************************
 * Browser
 *
 */
NoSquint.browser = NoSquint.ns(function() { with (NoSquint) {
    const CI = Components.interfaces;
    this.id = 'NoSquint.browser';
    var zoomAllTimer = null;             // Timer for queueZoomAll()
    var styleAllTimer = null;            // Timer for queueStyleAll()
    var updateStatusTimer = null;        // Timer for queueUpdateStatus()
    var tooltipDirty = false;            // True if tooltip needs updating on hover

    this.init = function() {
        this.gBrowser = gBrowser;
        this.updateZoomMenu();

        this.observer = new NSQ.interfaces.Observer();
        this.observer.watcher = {
            onEnterPrivateBrowsing: function() {
                this.closeSiteSettings();
                // Switching the private browsing mode.  Store any current pending
                // changes now.
                NSQ.prefs.saveSiteList(true);
                // Save current (non-private) site data for when we exit private
                // browsing.
                this.origSites = NSQ.prefs.cloneSites();
            },

            onExitPrivateBrowsing: function() {
                this.closeSiteSettings();
                // Restore previously saved site data and rezoom/style all tabs.
                NSQ.prefs.sites = this.origSites;
                this.origSites = null;
                NSQ.browser.zoomAll();
                NSQ.browser.styleAll();
            },

            closeSiteSettings: function() {
                if (NSQ.storage.dialogs.site)
                    NSQ.storage.dialogs.site.die();
            }
        };

        if (this.observer.inPrivateBrowsing)
            this.observer.watcher.onEnterPrivateBrowsing();

        window.addEventListener('DOMMouseScroll', this.handleMouseScroll, false); 
        // XXX: used for image zoom, which feature is currently removed.
        //window.addEventListener("resize", this.handleResize, false);
        gBrowser.tabContainer.addEventListener('TabOpen', this.handleTabOpen, false);
        gBrowser.tabContainer.addEventListener('TabSelect', this.handleTabSelect, false);
        gBrowser.tabContainer.addEventListener('TabClose', this.handleTabClose, false);
        
        this.zoomAll(null, true);
        this.styleAll(null);

        this.hookZoomButtonsForReset();
        NoSquint.prefs.checkVersionChange();
    };

    this.destroy = function() {
        if (NSQ.storage.dialogs.site)
            NSQ.storage.dialogs.site.die();

        /* When the window is closed, the TabClose event doesn't fire for each
         * browser tab automatically, so we must clean up explicitly.
         *
         * This fixes issue #1 which reports zombie compartments.
         */
        for (let browser in iter(gBrowser.browsers))
            this.detach(browser);

        this.observer.unhook();

        gBrowser.tabContainer.removeEventListener('TabOpen', this.handleTabOpen, false);
        gBrowser.tabContainer.removeEventListener('TabSelect', this.handleTabSelect, false);
        gBrowser.tabContainer.removeEventListener('TabClose', this.handleTabClose, false);
        window.removeEventListener('DOMMouseScroll', this.handleMouseScroll, false); 
    };

    this.hookZoomButtonsForReset = function() {
        if ($('zoom-out-button')) {
            $('zoom-out-button').onclick = $('zoom-in-button').onclick = 
                function(event) {
                    if (event.button == 1)
                        NoSquint.cmd.buttonReset(event);
                };

            /* TODO
            $('zoom-out-button').addEventListener('DOMMouseScroll', function(event) {
                // Implement wheel zooming over button here.
            }, false); 
            */
        }
    };

    /* Turns on the Addon Bar (Firefox 4)
     */
    this.enableAddonBar = function() {
        var bar = $('addon-bar');
        setToolbarVisibility(bar, true);
    };

    /* Checks whether the zoom buttons are added to any toolbar.  Returns a
     * 2-tuple [ver, where], where 'ver' is version (3 being NoSquint's, 4
     * being Firefox 4's native buttons) and where is the index within the
     * toolbar here the first button was found.
     */
    this.checkToolbar = function() {
        var [ver, button] = [4, $('zoom-controls')];
        if (!button)
            var [ver, button] = [3, $('nosquint-button-reduce')];
        if (!button)
            var [ver, button] = [3, $('nosquint-button-enlarge')];
        if (!button)
            return [0, null];
        else {
            var toolbar = button.parentNode;
            var set = toolbar.currentSet.split(',');
            return [ver, set.indexOf(button.id)];
        }
    };

    /* Adds or removes zoom buttons to the toolbar.  Action is a bitmask with
     * 1 being add, 2 being remove, and where is the position on the navbar to
     * add the buttons.  If where is not passed, a good default will be chosen.
     */
    this.modifyToolbar = function(action, where) {
        function remove(button) {
            if (!button)
                return;
            var toolbar = button.parentNode;
            var set = toolbar.currentSet.split(',');
            set.splice(set.indexOf(button.id), 1);
            toolbar.currentSet = set.join(',');
            toolbar.setAttribute('currentset', set.join(','));
            document.persist(toolbar.id, 'currentset');
        }

        if (action & 2) {
            remove($('nosquint-button-reduce'));
            remove($('nosquint-button-enlarge'));
            remove($('nosquint-button-reset'));
            remove($('zoom-controls'));
        }

        if (action & 1) {
            var navbar = $('nav-bar');
            var set = navbar.currentSet.split(',');
            if (where === undefined || where === null) {
                where = set.indexOf('search-container') + 1;
                if (where == 0)
                    where = set.length;
            }
            var ids = is3x() ? 'nosquint-button-reduce,nosquint-button-enlarge' : 'zoom-controls';
            set = set.slice(0, where).concat(ids).concat(set.slice(where));
            navbar.currentSet = set.join(',');
            navbar.setAttribute('currentset', set.join(','));
            document.persist(navbar.id, 'currentset');
            this.hookZoomButtonsForReset();
        }

        try {
            BrowserToolboxCustomizeDone(true);
        }
        catch (e) {}
    };


    /* Pops up the customize toolbar window.
     */
    this.customizeToolbar = function() {
        return BrowserCustomizeToolbar();
    };



    /* Event handlers.  Reminder: 'this' will not be NSQ.browser
     */

    this.handleMouseScroll = function(event) {
        if (!event.ctrlKey)
            return;
        if (NSQ.prefs.wheelZoomEnabled) {
            var browser, text, full, increment, img;
            browser = gBrowser.selectedBrowser;
            text = full = false;
            increment = NSQ.prefs.zoomIncrement * (event.detail < 0 ? 1 : -1);
            img = isImage(browser);
                
            if (NSQ.prefs.wheelZoomInvert)
                increment *= -1;

            if (NSQ.prefs.fullZoomPrimary && !event.shiftKey || !NSQ.prefs.fullZoomPrimary && event.shiftKey || img)
                full = Math.round((browser.markupDocumentViewer.fullZoom * 100) + increment);
            else
                text = Math.round((browser.markupDocumentViewer.textZoom * 100) + increment);

            NSQ.browser.zoom(browser, text, full);
            NSQ.browser.saveCurrentZoom();
        }
        event.stopPropagation();
        event.preventDefault();
    };


    // Would be used for image zoom, but currently not implemented.
    this.handleResize = function(event) {
    };

    this.handleTabOpen = function(event) {
        var browser = event.target.linkedBrowser;
        NSQ.browser.attach(browser);
        NSQ.browser.zoom(browser);
    };

    this.handleTabSelect = function(event) {
        NSQ.browser.updateStatus();
    };

    this.handleTabClose = function(event) {
        NSQ.browser.detach(event.target.linkedBrowser);
    };


    /* Updates View | Zoom menu to replace the default Zoom In/Out menu
     * items with Primary Zoom In/Out and Secondary Zoom In/Out.  Also the
     * "Zoom Text Only" menuitem is replaced with an option to open the NS
     * Global prefs.
     */
    this.updateZoomMenu = function() {
        var popup = $('viewFullZoomMenu').childNodes[0];
        var full_zoom_primary = NSQ.prefs.fullZoomPrimary;

        if (!$('nosquint-view-menu-settings')) {
            for (let [i, child] in enumerate(popup.childNodes)) {
                if (child.id == 'toggle_zoom')
                    child.hidden = true;
                if (child.nodeName != 'menuitem' || child.command === undefined ||
                    (child.command != 'cmd_fullZoomEnlarge' && child.command != 'cmd_fullZoomReduce'))
                    continue;

                var icon = document.defaultView.getComputedStyle(child, null).getPropertyValue('list-style-image');
                var enlarge = child.command == 'cmd_fullZoomEnlarge';
                var item = document.createElement('menuitem');
                var suffix = "noSquint" + (enlarge ? "Enlarge" : "Reduce") + "Secondary";
                item.setAttribute("command",  "cmd_" + suffix);
                item.setAttribute("key",  "key_" + suffix);
                item.style.listStyleImage = icon;
                popup.insertBefore(item, popup.childNodes[i + 2]);
            }

            var item = document.createElement('menuitem');
            item.id = 'nosquint-view-menu-settings';
            item.setAttribute('command', 'cmd_noSquintPrefs');
            item.setAttribute('label', NSQ.strings.zoomMenuSettings);
            popup.appendChild(item);
        }

        for (let child in iter(popup.childNodes)) {
            if (child.nodeName != 'menuitem')
                continue;
            var command = child.getAttribute('command');
            if (command == "cmd_fullZoomEnlarge")
                child.setAttribute('label', NSQ.strings['zoomMenuIn' + (full_zoom_primary ? "Full" : "Text")]);
            else if (command == "cmd_noSquintEnlargeSecondary")
                child.setAttribute('label', NSQ.strings['zoomMenuIn' + (full_zoom_primary ? "Text" : "Full")]);
            if (command == "cmd_fullZoomReduce")
                child.setAttribute('label', NSQ.strings['zoomMenuOut' + (full_zoom_primary ? "Full" : "Text")]);
            else if (command == "cmd_noSquintReduceSecondary")
                child.setAttribute('label', NSQ.strings['zoomMenuOut' + (full_zoom_primary ? "Text" : "Full")]);
        }
    };


    this.updateStatusTooltip = function() {
        if (!tooltipDirty)
            return;
        tooltipDirty = false;

        // Get cached sitename for current browser.
        var browser = gBrowser.selectedBrowser;
        var site = browser.getUserData('nosquint').site;
        var text = Math.round(browser.markupDocumentViewer.textZoom * 100);
        var full = Math.round(browser.markupDocumentViewer.fullZoom * 100);

        var e = $('nosquint-status');
        // updateStatusTooltip() won't be called unless site is not null.
        $('nosquint-status-tooltip-site').value = site.replace(/%20/g, ' ');
        $('nosquint-status-tooltip-full').value = full + '%';
        $('nosquint-status-tooltip-text').value = text + '%';

        var style = this.getStyleForBrowser(browser);
        var label = $('nosquint-status-tooltip-textcolor');
        label.style.color = style.colorText || 'inherit';
        label.style.backgroundColor = style.colorBackground || 'inherit';
        label.value = (style.colorText || style.colorBackground) ? 'Sample' : 'Site Controlled';

        var vis = $('nosquint-status-tooltip-vis-link');
        var unvis = $('nosquint-status-tooltip-unvis-link');
        unvis.value = vis.value = '';
        vis.style.color = vis.style.textDecoration = 'inherit';
        unvis.style.color = unvis.style.textDecoration = 'inherit';

        if (!style.linksUnvisited && !style.linksVisited)
            unvis.value = 'Site Controlled';
        else {
            for (let [attr, elem] in items({'linksUnvisited': unvis, 'linksVisited': vis})) {
                if (style[attr]) {
                    elem.value = attr.replace('links', '');
                    elem.style.color = style[attr];
                    elem.style.textDecoration = style.linksUnderline ? 'underline' : 'inherit';
                }
            }
        }
    };

    /* Updates the status panel and tooltip to reflect current site name
     * and zoom levels.
     */
    this.updateStatus = function() {
        // Get cached sitename for current browser.
        var browser = gBrowser.selectedBrowser;
        var site = browser.getUserData('nosquint').site;
        // Disable/enable context menu item.
        $('nosquint-menu-settings').disabled = (site === null);

        if (updateStatusTimer) {
            clearTimeout(updateStatusTimer);
            updateStatusTimer = null;
        }

        if (NSQ.prefs.hideStatus)
            // Pref indicates we're hiding status panel, no sense in updating.
            return;

        var e = $('nosquint-status');
        if (site) {
            var text = Math.round(browser.markupDocumentViewer.textZoom * 100);
            var full = Math.round(browser.markupDocumentViewer.fullZoom * 100);
            var [text_default, full_default] = NSQ.prefs.getZoomDefaults(site);

            if (NSQ.prefs.fullZoomPrimary)
                e.label = full + '%' + (text == text_default ? '' : (' / ' + text + '%'));
            else
                e.label = text + '%' + (full == full_default ? '' : (' / ' + full + '%'));

            $('nosquint-status-tooltip').style.display = '';
            e.style.fontStyle = e.style.opacity = 'inherit';
            tooltipDirty = true;
        } else {
            $('nosquint-status-tooltip').style.display = 'none';
            e.label = 'N/A';
            /* Lame: the documentation for statusbarpanel says there is a
             * disabled attribute.  The DOM Inspector says otherwise.  So we
             * must simulate the disabled look.
             */
            e.style.opacity = 0.5;
            e.style.fontStyle = 'italic';
            tooltipDirty = false;
        }
    };

    /* Queues an updateStatus().
     */
    this.queueUpdateStatus = function() {
        if (!updateStatusTimer)
            updateStatusTimer = setTimeout(function() NSQ.browser.updateStatus(), 1);
    };

    /* Given a browser, returns the site name.  Does not use the cached
     * site name user data attached to the browser.
     */
    this.getSiteFromBrowser = function(browser) {
        if (isChrome(browser))
            return null;
        return NSQ.prefs.getSiteFromURI(browser.currentURI);
    };

    /* Returns a 2-tuple [text, full] zoom levels for the given browser.
     * Defaults are applied.
     */
    this.getZoomForBrowser = function(browser) {
        var site = browser.getUserData('nosquint').site;
        debug('getZoomForBrowser(): site=' + site);
        if (site === undefined) {
            site = this.getSiteFromBrowser(browser);
            browser.getUserData('nosquint').site = site;
            debug('getZoomForBrowser(): after getSiteFromBrowser(), site=' + site);
        }

        var [text, full] = NSQ.prefs.getZoomForSite(site);
        var [text_default, full_default] = NSQ.prefs.getZoomDefaults(site);
        return [text || text_default, full || full_default];
    };


    /* Saves the current tab's zoom level in the site list.
     */
    this.saveCurrentZoom = function() {
        var browser = gBrowser.selectedBrowser;
        var site = browser.getUserData('nosquint').site;
        if (!site)
            // Nothing to save.  Chrome maybe.
            return;

        var text = Math.round(browser.markupDocumentViewer.textZoom * 100);
        var full = Math.round(browser.markupDocumentViewer.fullZoom * 100);
        debug("saveCurrentZoom(): site=" + site);
        NSQ.prefs.updateSiteList(site, [text, full]);
    };

    this.attach = function(browser) {
        var listener = new NSQ.interfaces.ProgressListener(browser);
        browser.addProgressListener(listener, CI.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
        debug('attach(): attached browser URI=' + browser.docShell.document.URL);

        var userData = {
            listener: listener,
            stylers: [],
            handleDOMFrameContentLoaded: function(event) {
                if (!event.target.contentWindow)
                    return;
                var styler = NSQ.browser.getDocumentStyler(browser, event.target.contentWindow.document);
                styler();
                browser.getUserData('nosquint').stylers.push(styler);
            }
        };
        browser.setUserData('nosquint', userData, null);
        browser.addEventListener('DOMFrameContentLoaded', userData.handleDOMFrameContentLoaded, true);
    };

    /* Undoes an attach(); called from TabClose event and destroy()
     */
    this.detach = function(browser) {
        var userData = browser.getUserData('nosquint');
        browser.removeProgressListener(userData.listener);
        browser.removeEventListener('DOMFrameContentLoaded', userData.handleDOMFrameContentLoaded, true);
        browser.setUserData('nosquint', null, null);
    };

    /* Zooms text and/or full zoom to the specified level.  If text or full is
     * null, the default for browser is used.  If it is false, it is
     * untouched.  Status bar is updated, but new level is NOT saved.
     */
    this.zoom = function(browser, text, full) {
        if (!browser || (text == false && full == false))
            return false;

        var t0 = new Date().getTime();
        if (text == null || full == null) {
            var [site_text, site_full] = this.getZoomForBrowser(browser);
            if (text == null)
                text = text || site_text;
            if (full == null)
                full = full || site_full;
            // Only zoom web content, not chrome or plugins (e.g. PDF)
            //if (!browser.getUserData('nosquint').site)
            //    [text, full] = [100, 100];
        }

        debug("zoom(): text=" + text + ", full=" + full);
        if (text !== false)
            browser.markupDocumentViewer.textZoom = text / 100.0;
        if (full !== false)
            browser.markupDocumentViewer.fullZoom = full / 100.0;
        if (browser == gBrowser.selectedBrowser)
            this.queueUpdateStatus();
        var t1 = new Date().getTime();
        debug('zoom(): took ' + (t1-t0));
        return true;
    };

    /* Updates the zoom levels for all tabs; each tab is set to the levels
     * for the current URIs of each browser.  If 'attach' is true, then
     * ProgressListeners are attached to each browser as well.  This is
     * useful on initialization, where we can hook into any tabs that may
     * have been opened prior to initialization.
     */
    this.zoomAll = function(site, attach) {
        debug("zoomAll(): site=" + site + ", attach=" + attach);
        for (let browser in iter(gBrowser.browsers)) {
            if (site && site != browser.getUserData('nosquint').site)
                continue;
            if (attach)
                this.attach(browser);
            this.zoom(browser);
        }
        clearTimeout(zoomAllTimer);
        zoomAllTimer = null;
    };

    /* Queues a zoomAll.  Useful when we might otherwise call zoomAll() 
     * multiple times, such as in the case of multiple preferences being
     * updated at once.
     */
    this.queueZoomAll = function(site, delay) {
        if (delay === undefined)
            delay = 1;
        if (!zoomAllTimer)
            zoomAllTimer = setTimeout(function() NSQ.browser.zoomAll(site), delay);
    };


    /* Returns a style object for the given browser.  Defaults are applied.
     */
    this.getStyleForBrowser = function(browser) {
        var site = browser.getUserData('nosquint').site;
        var style = NSQ.prefs.getStyleForSite(site);
        return NSQ.prefs.applyStyleGlobals(style);
    };

    /* Returns CSS string for the given style object.
     */
    this.getCSSFromStyle = function(style) {
        var css = '';
        if (style.colorText || style.colorBackground || style.colorBackgroundImages) {
            css += 'body,p,div,span,font,ul,li,center,blockquote,h1,h2,h3,h4,h5,table,tr,th,td,iframe,a,b,i {';
            if (style.colorText)
                css += 'color: ' + style.colorText + ' !important;';
            if (style.colorBackground)
                css += 'background-color: ' + style.colorBackground + ' !important;';
            if (style.colorBackgroundImages)
                css += 'background-image: none !important;';
            css += '}\n';
        };

        if (style.linksUnvisited)
            css += 'a:link { color: ' + style.linksUnvisited + ' !important; }\n';
        if (style.linksVisited)
            css += 'a:visited { color: ' + style.linksVisited + ' !important; }\n';
        if (style.linksUnderline)
            css += 'a { text-decoration: underline !important; }\n';

        return css;
    };

    /* Returns a function that, when invoked, will style the given document
     * from the given browser.  The styler function can be explicitly passed
     * a style attributes object to override the calculated one for the site.
     */
    this.getDocumentStyler = function(browser, doc) {
        var styleobj = null;
        function styler(style) {
            if (!style)
                style = NSQ.browser.getStyleForBrowser(browser);

            debug("styler(): enabled=" + style.enabled + ", obj=" + styleobj);
            if (style.enabled) {
                if (!styleobj) {
                    styleobj = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
                    // This doesn't appear to be necessary, and in any case seems
                    // to not work when there are CSS problems on the site (like google
                    // sometimes has).
                    //var head = doc.getElementsByTagName('head');
                    //var node = (head ? head[0] : doc.documentElement);
                    //node.insertBefore(styleobj, node.childNodes[0]);
                    doc.documentElement.appendChild(styleobj);
                }
                var css = NSQ.browser.getCSSFromStyle(style);
                styleobj.textContent = css;
            } else if (styleobj) {
                styleobj.parentNode.removeChild(styleobj);
                // Must recreate style object if we want to attach later.
                styleobj = null;
            }
        }
        return styler;
    };

    /* Adds a styler to the given document if none exist, and invokes all
     * attached stylers with the given style.
     *
     * If the document cannot be styled, false is returned.  Otherwise, true.
     */
    this.style = function(browser, style) {
        var doc = browser.docShell.document;
        if (!doc.documentElement)
            // Nothing to style; chrome?
            return false;

        var stylers = browser.getUserData('nosquint').stylers;
        if (stylers.length == 0)
            // Initial styling; attach styler for document (or frameset).
            stylers.push(this.getDocumentStyler(browser, doc));

        debug("style(): num stylers=" + stylers.length);
        for (let styler in iter(stylers))
            styler(style);

        if (browser == gBrowser.selectedBrowser)
            this.queueUpdateStatus();

        return true;
    };

    this.styleAll = function(site) {
        for (let browser in iter(gBrowser.browsers)) {
            if (site && site != browser.getUserData('nosquint').site)
                continue;
            this.style(browser);
        }
        clearTimeout(styleAllTimer);
        styleAllTimer = null;
    };

    /* Queues a styleAll.
     */
    this.queueStyleAll = function(site, delay) {
        if (delay === undefined)
            delay = 1;
        if (!styleAllTimer)
            styleAllTimer = setTimeout(function() NSQ.browser.styleAll(site), delay);
    };
}});
