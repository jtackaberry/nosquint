window.addEventListener("load", NoSquint.init, false); 
window.addEventListener("unload", NoSquint.destroy, false); 


ZoomManager.prototype.getInstance().reset = function() {
    if (ZoomManager.prototype.getInstance().textZoom == NoSquint.defaultZoomLevel)
        return;

    ZoomManager.prototype.getInstance().textZoom = NoSquint.defaultZoomLevel;
    NoSquint.saveCurrentZoom();
    NoSquint.updateStatus();
}

ZoomManager.prototype.getInstance().enlarge = function() {
    // FIXME: do we want to update any other tabs of pages in this site?
    ZoomManager.prototype.getInstance().textZoom += NoSquint.zoomIncrement;
    NoSquint.saveCurrentZoom();
    NoSquint.updateStatus();
    dump("Enlarge text\n");
}

ZoomManager.prototype.getInstance().reduce = function() {
    ZoomManager.prototype.getInstance().textZoom -= NoSquint.zoomIncrement;
    NoSquint.saveCurrentZoom();
    NoSquint.updateStatus();
    dump("Reduce text\n");
}
