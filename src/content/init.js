window.addEventListener("load", NoSquint.init, false); 
window.addEventListener("unload", NoSquint.destroy, false); 

ZoomManager._nosquintPendingZoom = null;
ZoomManager._nosquintOrigZoomGetter = ZoomManager.__lookupGetter__('zoom');
ZoomManager._nosquintOrigZoomSetter = ZoomManager.__lookupSetter__('zoom');

ZoomManager.__defineSetter__('zoom', function(value) {
    /* XXX: Horrid hack, makes baby Jesus cry.
     *
     * Problem: on location change and tab change, some internal FF mechanism
     * sets zoom to some stored value (on a per site basis).  NoSquint
     * must fully override this mechanism, as we implement our own approach.
     *
     * Solution: rather than update zoom on the current browser immediately,
     * we queue it with a timer, and give the location/tab change handlers
     * in nosquint.js a chance to abort the queued zoom via
     * NoSquint.abortPendingZoomManager()
     */
    ZoomManager._nosquintPendingZoom = value;
    if (NoSquint.zoomManagerTimeout == false) {
        dump("[nosquint] EATING ZOOM REQUEST: "+ value + "\n");
        NoSquint.zoomManagerTimeout = null;
        return;
    }
    NoSquint.zoomManagerTimeout = setTimeout(function() { 
        dump("[nosquint] setting zoom through ZoomManager: " + value + "\n");
        ZoomManager._nosquintOrigZoomSetter(value);
        NoSquint.zoomManagerTimeout = null;
        ZoomManager._nosquintPendingZoom = null;
    }, 0);
});


ZoomManager.__defineGetter__('zoom', function() {
    if (ZoomManager._nosquintPendingZoom != null)
        return ZoomManager._nosquintPendingZoom;
    return ZoomManager._nosquintOrigZoomGetter();
});

ZoomManager.enlarge = function() {
    // FIXME: do we want to update any other tabs of pages in this site?
    getBrowser().mCurrentBrowser.markupDocumentViewer.fullZoom += (NoSquint.zoomIncrement / 100.0);
    NoSquint.saveCurrentZoom();
    NoSquint.updateStatus();
}

ZoomManager.reduce = function() {
    getBrowser().mCurrentBrowser.markupDocumentViewer.fullZoom -= (NoSquint.zoomIncrement / 100.0);
    NoSquint.saveCurrentZoom();
    NoSquint.updateStatus();
}

ZoomManager.reset = function() {
    var viewer = getBrowser().mCurrentBrowser.markupDocumentViewer;
    var page_zoom_default = NoSquint.getZoomDefaults()[1];
    if (Math.round(viewer.fullZoom * 100.0) == page_zoom_default)
        // Page zoom is already at default.
        return false;
    viewer.fullZoom = page_zoom_default / 100.0;
    NoSquint.saveCurrentZoom();
    NoSquint.updateStatus();
    return true;
}
