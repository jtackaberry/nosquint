NoSquint.interfaces = NoSquint.ns(function() { with (NoSquint) {
    const CI = Components.interfaces;

    this.id = 'NoSquint.interfaces';

    /* Specifies at which state we will try to zoom and style the page.  With
     * 3.5+, we can style early with STATE_TRANSFERRING.  With 3.0, we seem to
     * have style later at STATE_STOP in order to get reliable results. (In 3.0
     * using STATE_TRANSFERRING, on e.g. youtube.com the search bar is
     * improperly rendered.  [And this, quite perplexingly, is caused by
     * accessing doc.documentElement in NSQ.browser.style()])
     */
    var stateFlag = is30() ? Components.interfaces.nsIWebProgressListener.STATE_STOP
                           : Components.interfaces.nsIWebProgressListener.STATE_TRANSFERRING;
    //var stateFlag = Components.interfaces.nsIWebProgressListener.STATE_STOP;

    /* Listener used to receive notifications when a new URI is about to be loaded.
     * TODO: when support for Firefox 3.0 is dropped, use:
     *          https://developer.mozilla.org/En/Listening_to_events_on_all_tabs
     */
    this.ProgressListener = function(browser) {
        this.id = 'NoSquint.interfaces.ProgressListener';
        this.browser = browser;
    }

    this.ProgressListener.prototype = {
        QueryInterface: function(aIID) {
            if (aIID.equals(CI.nsIWebProgressListener) ||
                aIID.equals(CI.nsISupportsWeakReference) ||
                aIID.equals(CI.nsISupports))
                return this;
            throw Components.results.NS_NOINTERFACE;
        },

        onLocationChange: function(progress, request, uri) {
            // Ignore url#foo -> url#bar location changes
            if (!request)
                return;

            // If we're here, a new document will be loaded next.
            this.contentType = this.browser.docShell.document.contentType;
            this.styleApplied = false;
            this.zoomApplied = false;

            // Remove any stylers from the last document.
            var userData = this.browser.getUserData('nosquint');
            userData.stylers = [];

            var site = NSQ.browser.getSiteFromBrowser(this.browser);
            if (site == userData.site)
                // New document on the same site.
                return;

            debug("onLocationChange(): old=" + userData.site + ", new=" + site + ", uri=" + uri.spec);
            /* Update timestamp for site.  This isn't _quite_ perfect because
             * the timestamp is only updated for the first page load on that site
             * rather than the last.  But it should be good enough in practice, and
             * avoids updating the site list on _every_ page load.
             */
            NSQ.prefs.updateSiteTimestamp(site);
            userData.site = site;

            /* Now zoom the current browser for the proper zoom level for this site.
             * It's expected that this zoom level will not get modified from under us.
             * However, this has happened with a Firefox 3.6 nightly -- see bug
             * #516513.  That bug got fixed, so it seems to be safe to zoom here.
             * If the problem resurfaces, we will need to move the zooming into
             * onStateChange the way styling is currently hooked.
             * XXX: 3.6 private browsing mode exhibits some problems, so zooming
             * is back in onStateChange.
             */
            NSQ.browser.zoom(this.browser);

            // If the site settings dialog was open from this browser, sync it.
            var dlg = NSQ.storage.dialogs.site;
            if (dlg && dlg.browser == this.browser)
                dlg.setBrowser(NSQ.browser, this.browser);
        },

        onStateChange: function(progress, request, state, astatus) {
            //debug("LISTENER: request=" + request + ", state=" + state + ", status=" + 
            //      astatus + ", type=" + this.browser.docShell.document.contentType);

            /* Check the current content type against the content type we initially got.
             * This changes in the case when there's an error page (e.g. dns failure),
             * which we treat as chrome and do not adjust.
             */
            var contentType = this.browser.docShell.document.contentType;
            if (this.contentType != contentType) {
                this.contentType = contentType;
                var userData = this.browser.getUserData('nosquint');
                if (isChrome(this.browser)) {
                    // Content type is changed and it's now chrome.  Unzoom (or
                    // zoom to 100%)
                    userData.site = null;
                    NSQ.browser.zoom(this.browser, 100, 100);
                } else if (userData.site === null) {
                    // Was considered chrome, but now isn't.  Rezoom/style.
                    delete userData.site;
                    NSQ.browser.zoom(this.browser);
                    this.styleApplied = NSQ.browser.style(this.browser);
                }
            } else if (state & stateFlag) {
                if (!this.zoomApplied) {
                    this.zoomApplied = true;
                    NSQ.browser.zoom(this.browser);
                }
                if (!this.styleApplied) {
                    if (!isChrome(this.browser) || isImage(this.browser))
                        this.styleApplied = NSQ.browser.style(this.browser);
                    else
                        this.styleApplied = true;
                }
            } else if (state & Components.interfaces.nsIWebProgressListener.STATE_IS_DOCUMENT &&
                       this.browser.getUserData('nosquint').site == null && !is30()) {
                /* Kludge: when moving a tab from one window to another, the
                 * listener previously created and attached in
                 * NSQ.browser.attach() seems to either stop working or gets
                 * implicitly detached somewhere afterward.  The tab gets
                 * created initially as about:blank, so NoSquint thinks it's
                 * chrome.  The tab gets updated for the proper site, but since
                 * the listener isn't working, NoSquint doesn't hear about it.
                 *
                 * The specific magical incantation to deal with this seems to
                 * be handling STATE_IS_DOCUMENT when site=null.  After a 0ms
                 * timer, we try to re-add this listener ('this').  If it
                 * fails, we assume the listener from attach() is still there
                 * and everything is cool after all.  Otherwise, regenerate the
                 * site name and rezooms/style.
                 *
                 * This seems to solve the problem, but feels like a nasty volatile
                 * hack to work around what is probably a firefox bug, and will
                 * likely break in the future.  It doesn't seem to be necessary
                 * with 3.0, but is with 3.5+.
                 */
                var browser = this.browser;
                var listener = this;
                setTimeout(function() {
                    try {
                        browser.addProgressListener(listener, CI.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
                    } catch (err) {
                        // Assume ProgressListener was already attached after all, so
                        // we don't need to do anything.
                        return;
                    }
                    browser.getUserData('nosquint').listener = listener;
                    // Forces getZoomForBrowser() (via zoom()) to redetermine site name.
                    delete browser.getUserData('nosquint').site;
                    NSQ.browser.zoom(browser);
                    NSQ.browser.style(browser);
                }, 0);
            }

        },

        onProgressChange: function() 0,
        onStatusChange: function() 0,
        onSecurityChange: function() 0,
        onLinkIconAvailable: function() 0,
    };



    /* Custom observer attached to nsIObserverService.  Used to detect changes
     * to private browsing state, and addon disable/uninstall.  Some code
     * borrowed from https://developer.mozilla.org/En/Supporting_private_browsing_mode
     */
    this.Observer = function() {  
        this.id = 'NoSquint.interfaces.Observer';
        this.init();
    };

    this.Observer.prototype = {  
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
            this._os.addObserver(this, "private-browsing", false);  
            this._os.addObserver(this, "quit-application-granted", false);  
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
                    NSQ.storage.quitting = true;
                    this._unhook();
                    break;

                case "em-action-requested":
                    switch (data) {
                        case "item-disabled":
                        case "item-uninstalled":
                            var item = subject.QueryInterface(Components.interfaces.nsIUpdateItem);
                            if (item.id != 'nosquint@urandom.ca' || NSQ.storage.disabled)
                                break;

                            NSQ.storage.disabled = true;
                            if (popup('confirm', NSQ.strings.disableTitle, NSQ.strings.disablePrompt) == 1) {
                                // Clicked no
                            } else
                                NSQ.prefs.setSiteSpecific(true);
                            break;
                        
                        case "item-cancel-action":
                            var item = subject.QueryInterface(Components.interfaces.nsIUpdateItem);
                            if (item.id != 'nosquint@urandom.ca' || NSQ.storage.disabled != true)
                                break;
                            NSQ.prefs.setSiteSpecific(false);
                            NSQ.storage.disabled = false;
                    }
                    break;
            }
        },  
       
        get inPrivateBrowsing() {  
            return this._inPrivateBrowsing;  
        }
    }; 
}});
