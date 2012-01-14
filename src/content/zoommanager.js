/* NoSquint hooks the ZoomManager, overriding its default functionality.
 *
 * The logic below should be well-behaved when the user uses exclusively
 * full page or text-only zooms.
 *
 * If both zooms are in use (i.e. full and text != 100%), things can get
 * a little dubious.  In general, if full zoom is not 100%, then we pretend
 * as if full zoom is the primary method, regardless of whether it actually
 * is.  The rationale is that full page zoom is more likely to affect logic
 * used by people interfacing with ZoomManager.
 *
 * More details in ZoomManager.useFullZoom getter.
 */

// ZoomManager._nosquintOrigZoomGetter = ZoomManager.__lookupGetter__('zoom');
// ZoomManager._nosquintOrigZoomSetter = ZoomManager.__lookupSetter__('zoom');

ZoomManager.__defineSetter__('zoom', function(value) {
    var viewer = getBrowser().mCurrentBrowser.markupDocumentViewer;
    var updated = false;

    if (ZoomManager.useFullZoom && viewer.fullZoom != value)
        updated = viewer.fullZoom = value;
    else if (!ZoomManager.useFullZoom && viewer.textZoom != value)
        updated = viewer.textZoom = value;

    if (updated != false) {
        NoSquint.browser.saveCurrentZoom();
        NoSquint.browser.updateStatus();
    }
});

ZoomManager.__defineGetter__('zoom', function() {
    var viewer = getBrowser().mCurrentBrowser.markupDocumentViewer;
    return ZoomManager.useFullZoom ? viewer.fullZoom : viewer.textZoom;
});

ZoomManager.__defineGetter__('useFullZoom', function() {
    /* Extensions (like all-in-one gestures) assume that zoom is either all
     * full page or all text-only, which is of course quite reasonable given
     * that the ZoomManager interface assumes this too.
     *
     * So, regardless of what the primary zoom method is set to, if the
     * current page has a full zoom level != 100%, then we always return
     * true here.
     * 
     * This is to handle the uncommon case where the user has modified
     * both text and full page zoom.  Extensions like AIO need to base
     * decisions on whether or not the page is full-zoomed, not whether
     * or not the user prefers full or text zoom.
     */
    var viewer = getBrowser().mCurrentBrowser.markupDocumentViewer;
    return viewer.fullZoom != 1.0 ? true : NoSquint.prefs.fullZoomPrimary;
});

ZoomManager.enlarge = NoSquint.cmd.enlargePrimary;
ZoomManager.reduce = NoSquint.cmd.reducePrimary;
ZoomManager.reset = NoSquint.cmd.reset;

FullZoom.enlarge = NoSquint.cmd.enlargeFullZoom;
FullZoom.reduce = NoSquint.cmd.reduceFullZoom;
FullZoom.reset = NoSquint.cmd.reset;
