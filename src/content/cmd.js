/******************************************************************************
 * Commands
 *
 * Functions that are invoked as a result of some UI action.
 *
 */
NoSquint.cmd = NoSquint.ns(function() { with (NoSquint) {

    /* Handlers for toolar buttons */
    this.buttonEnlarge = function(event) {
        event.shiftKey ? NSQ.cmd.enlargeSecondary() : NSQ.cmd.enlargePrimary();
    };

    this.buttonReduce = function(event) {
        event.shiftKey ? NSQ.cmd.reduceSecondary() : NoSquint.cmd.reducePrimary();
    };

    this.buttonReset = function(event) {
        //event.stopPropagation();
        //event.preventDefault();
        NSQ.cmd.reset();
    };

    /* Handlers for commands defined in overlay.xul */
    this.enlargePrimary = function() {
        NSQ.prefs.fullZoomPrimary ? NSQ.cmd.enlargeFullZoom() : NSQ.cmd.enlargeTextZoom();
    };

    this.reducePrimary = function() {
        NSQ.prefs.fullZoomPrimary ? NSQ.cmd.reduceFullZoom() : NSQ.cmd.reduceTextZoom();
    };

    this.enlargeSecondary = function() {
        NSQ.prefs.fullZoomPrimary ? NSQ.cmd.enlargeTextZoom() : NSQ.cmd.enlargeFullZoom();
    };

    this.reduceSecondary = function() {
        NSQ.prefs.fullZoomPrimary ? NSQ.cmd.reduceTextZoom() : NSQ.cmd.reduceFullZoom();
    };

    this.reset = function() {
        var browser = getBrowser().mCurrentBrowser;
        var [text, full] = NSQ.prefs.getZoomDefaults(NSQ.browser.getSiteFromBrowser(browser));
        var viewer = browser.markupDocumentViewer;
        var updated = false;

        if (Math.round(viewer.textZoom * 100.0) != text)
            updated = viewer.textZoom = text / 100.0;
        if (Math.round(viewer.fullZoom * 100.0) != full)
            updated = viewer.fullZoom = full / 100.0;
        
        if (updated != false) {
            NSQ.browser.saveCurrentZoom();
            NSQ.browser.updateStatus();
        }
    };

    this.enlargeTextZoom = function() {
        var browser = getBrowser().mCurrentBrowser;
        if (isImage(browser))
            return NSQ.cmd.enlargeFullZoom();
        var mdv = browser.markupDocumentViewer;
        mdv.textZoom = Math.round(mdv.textZoom * 100.0 + NSQ.prefs.zoomIncrement) / 100.0;
        NSQ.browser.saveCurrentZoom();
        NSQ.browser.updateStatus();
    };

    this.reduceTextZoom = function() {
        var browser = getBrowser().mCurrentBrowser;
        if (isImage(browser))
            return NSQ.cmd.reduceFullZoom();
        var mdv = browser.markupDocumentViewer;
        mdv.textZoom = Math.round(mdv.textZoom * 100.0 - NSQ.prefs.zoomIncrement) / 100.0;
        NSQ.browser.saveCurrentZoom();
        NSQ.browser.updateStatus();
    };

    this.enlargeFullZoom = function() {
        var browser = getBrowser().mCurrentBrowser;
        if (isImage(browser) && browser.getUserData('nosquint').fit)
            return;
        var mdv = browser.markupDocumentViewer;
        mdv.fullZoom = Math.round(mdv.fullZoom * 100.0 + NSQ.prefs.zoomIncrement) / 100.0;
        NSQ.browser.saveCurrentZoom();
        NSQ.browser.updateStatus();
    };

    this.reduceFullZoom = function() {
        var browser = getBrowser().mCurrentBrowser;
        if (isImage(browser) && browser.getUserData('nosquint').fit)
            return;
        var mdv = browser.markupDocumentViewer;
        mdv.fullZoom = Math.round(mdv.fullZoom * 100.0 - NSQ.prefs.zoomIncrement) / 100.0;
        NSQ.browser.saveCurrentZoom();
        NSQ.browser.updateStatus();
    };

    /* Called when a menuitem from the status panel context menu is selected. */
    this.popupItemSelect = function(event) {
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
                NSQ.browser.zoom(browser, level, false);
            else
                NSQ.browser.zoom(browser, false, level);
            NSQ.browser.saveCurrentZoom();
        }
    };

    /* Handle left/middle/right click on the status panel. */
    this.statusPanelClick = function(event) {
        if (event.button == 0)
            // Left click, open site prefs.
            return NSQ.cmd.openSiteSettings();
        else if (event.button == 1)
            // Middle click, open global prefs.
            return NSQ.cmd.openGlobalSettings();
    }

    this.statusPanelPrepareMenu = function(event) {
        if (event.button != 2)
            // Not a right click.
            return;

        /* Setup the context menu according to the current browser tab: the
         * site name is set, and the appropriate radio menuitems get selected.
         */
        var popup = $('nosquint-status-popup');
        var browser = gBrowser.selectedBrowser;
        var site = browser.getUserData('nosquint').site;

        // Hide all but the last menuitem if there is no site
        for (let [n, child] in enumerate(popup.childNodes))
            child.style.display = (site || n == popup.childNodes.length-1) ? '' : 'none';

        var popup_text = $('nosquint-status-popup-text');
        var popup_full = $('nosquint-status-popup-full');

        var current_text = Math.round(browser.markupDocumentViewer.textZoom * 100);
        var current_full = Math.round(browser.markupDocumentViewer.fullZoom * 100);

        popup.childNodes[0].label = site;

        for (let child in iter(popup_text.childNodes))
            child.setAttribute('checked', child.label.replace(/%/, '') == current_text);
        for (let child in iter(popup_full.childNodes))
            child.setAttribute('checked', child.label.replace(/%/, '') == current_full);

        //popup.openPopupAtScreen(event.screenX, event.screenY, true);
    };


    /* Opens the site prefs dialog, or focuses it if it's already open.
     * In either case, the values of the dialog are updated to reflect the
     * current browser tab.
     */
    this.openSiteSettings = function() {
        var browser = gBrowser.selectedBrowser;
        if (!browser.getUserData('nosquint').site)
            // Chrome
            return;
        var dlg = NSQ.storage.dialogs.site;
        if (dlg)
            return dlg.setBrowser(NSQ.browser, browser);
        window.openDialog('chrome://nosquint/content/dlg-site.xul', 'nsqSite', 'chrome', NSQ.browser, browser);
    };


    /* Opens global prefs dialog or focuses it if it's already open. */
    this.openGlobalSettings = function(browser) {
        var dlg = NSQ.storage.dialogs.global;
        if (dlg)
            return dlg.focus();

        browser = browser || gBrowser.selectedBrowser;
        var host = browser.currentURI.asciiHost;
        try {
            if (browser.currentURI.port > 0)
                host += ':' + browser.currentURI.port;
        } catch (err) {};
        var url = host + browser.currentURI.path;
        window.openDialog('chrome://nosquint/content/dlg-global.xul', 'nsqGlobal', 'chrome', url);
    };

    this.showToolbarPanel = function() {
        var panel = $('nosquint-toolbar-buttons-notify');
        var anchor = $('zoom-out-button');
        if (!anchor)
            anchor = $('nosquint-button-reduce');
        panel.openPopup(anchor, 'after_start', 0, 0, false, false, null);
        defer(5000, function() {
            panel.hidePopup();
        });
    };

}});
