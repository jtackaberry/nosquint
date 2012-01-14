window.addEventListener("load", NoSquint.init, false); 
window.addEventListener("unload", NoSquint.destroy, false); 

// Hook ZoomManager in order to override Firefox's internal per-site
// zoom memory feature.

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

ZoomManager.enlarge = NoSquint.cmdEnlargePrimary;
ZoomManager.reduce = NoSquint.cmdReducePrimary;
ZoomManager.reset = NoSquint.cmdReset;
