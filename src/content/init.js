// Global object for NoSquint.  'NoSquint' is the only name added to the global
// namespace by this addon.
NoSquint = {
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

    init: function() {
        if (NoSquint._initialized)
            return;
        NoSquint._initialized = true;

        for (let i = 0; i < NoSquint.namespaces.length; i++) {
            var scope = NoSquint.namespaces[i];
            if (scope.init !== undefined)
                scope.init();
        }
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
