var TestExtension = {
    prefs: null,

    init: function() {
        var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(
                          Components.interfaces.nsIPrefService);
        TestExtension.prefs = prefs.getBranch("extensions.testextension.");
        TestExtension.prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
        TestExtension.prefs.addObserver("", this, false);
    },

    destroy: function() {
        try {
            TestExtension.prefs.removeObserver("", this);
        } catch (err) {
            dump(err + "\n");
        }
    },

    observe: function(subject, topic, data) {
    },
};


window.addEventListener("load", TestExtension.init, false); 
window.addEventListener("unload", TestExtension.destroy, false); 
