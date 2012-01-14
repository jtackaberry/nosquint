// Global object for NoSquint.  'NoSquint' is the only name added to the global
// namespace by this addon.
var NoSquint = {
    id: 'NoSquint',
    namespaces: [],
    _initialized: false,
    dialogs: {},            // dialogs namespace

    ns: function(fn) {
        var scope = {
            extend: function(o) {
                for (var key in o)
                    this[key] = o[key];
                }
        };
        scope = fn.apply(scope) || scope;
        NoSquint.namespaces.push(scope);
        return scope;
    },

    /* This function is the load handler.  It calls init() on all namespaces
     * previously registered with ns(), which happens for most .js files that
     * are loaded via the overlay.
     *
     * Consequently, init() for each namespace should be kept light so as not
     * to adversely affect load times.
     *
     * Currently initialization takes about 5-10ms with ff4 on my fairly peppy
     * Thinkpad (i7 M 620 2.67GHz), which isn't horrible, but there's room for
     * improvement.
     */
    init: function() {
        if (NoSquint._initialized)
            return;
        NoSquint._initialized = true;

        //var t0 = new Date().getTime();
        for (let i = 0; i < NoSquint.namespaces.length; i++) {
            //var t1 = new Date().getTime();
            var scope = NoSquint.namespaces[i];
            if (scope.init !== undefined)
                scope.init();
            //dump(scope.id + " init took " + (new Date().getTime() - t1) + "\n");
        }
        //dump("Total init took: " + (new Date().getTime() - t0) + "\n");
    },

    destroy: function() {
        // Invoke destroy functions in all registered namespaces
        for (let i = 0; i < NoSquint.namespaces.length; i++) {
            var scope = NoSquint.namespaces[i];
            if (scope.destroy !== undefined)
                scope.destroy();
        }
    }
};

window.addEventListener("load", NoSquint.init, false); 
window.addEventListener("unload", NoSquint.destroy, false);
