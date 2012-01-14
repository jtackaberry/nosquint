window.addEventListener("load", NoSquint.init, false); 
window.addEventListener("unload", NoSquint.destroy, false); 


ZoomManager.prototype.getInstance().reset = function() {
    ZoomManager.prototype.getInstance().textZoom = NoSquint.defaultZoomLevel;
    NoSquint.saveCurrentZoom();
}

ZoomManager.prototype.getInstance().enlarge = function() {
    ZoomManager.prototype.getInstance().textZoom += 10;
    NoSquint.saveCurrentZoom();
}

ZoomManager.prototype.getInstance().reduce = function() {
    ZoomManager.prototype.getInstance().textZoom -= 10;
    NoSquint.saveCurrentZoom();
}
