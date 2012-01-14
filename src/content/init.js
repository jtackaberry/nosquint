window.addEventListener("load", NoSquint.init, false); 
window.addEventListener("unload", NoSquint.destroy, false); 


ZoomManager.prototype.getInstance().reset = function() {
    ZoomManager.prototype.getInstance().textZoom = NoSquint.defaultZoomLevel;
    NoSquint.saveCurrentZoom();
}

ZoomManager.prototype.getInstance().enlarge = function() {
    // FIXME: do we want to update any other tabs of pages in this domain?
    ZoomManager.prototype.getInstance().textZoom += NoSquint.zoomIncrement;
    NoSquint.saveCurrentZoom();
}

ZoomManager.prototype.getInstance().reduce = function() {
    ZoomManager.prototype.getInstance().textZoom -= NoSquint.zoomIncrement;
    NoSquint.saveCurrentZoom();
}
