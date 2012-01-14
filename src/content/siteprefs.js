var NoSquintSitePrefs = {
    prefs: null,
    browser: null,
    NoSquint: null,
    bundle: null,

    init: function(doc, dialog) {
        NoSquintSitePrefs.doc = doc;
        NoSquintSitePrefs.dialog = dialog;
        NoSquintSitePrefs.NoSquint = window.arguments[0];
        NoSquintSitePrefs.prefs = NoSquintSitePrefs.NoSquint.prefs;
        NoSquintSitePrefs.bundle = doc.getElementById('nosquint-prefs-bundle');
        NoSquintSitePrefs.NoSquint.siteDialog = this;

        doc.getElementById('full-zoom-level').onchange = function() { NoSquintSitePrefs.valueChange('full', this); }
        doc.getElementById('text-zoom-level').onchange = function() { NoSquintSitePrefs.valueChange('text', this); }
        NoSquintSitePrefs.setValues(window.arguments[1], window.arguments[2]);
    },

    setValues: function(browser, site) {
        var doc = NoSquintSitePrefs.doc;
        var [text, full] = NoSquintSitePrefs.NoSquint.getLevelForBrowser(browser);

        NoSquintSitePrefs.browser = browser;
        NoSquintSitePrefs.site = site;

        doc.getElementById('text-zoom-slider').value = text;
        doc.getElementById('full-zoom-slider').value = full;

        var caption = doc.getElementById('site').childNodes[0];
        caption.label = NoSquintSitePrefs.bundle.getString('settingsFor') + " " + site;

    },

    sliderChange: function(which, slider) {
        var doc = NoSquintSitePrefs.doc;
        slider.value = parseInt(slider.value / 5) * 5;
        if (doc)
            doc.getElementById(which + '-zoom-level').value = slider.value;
        return 5;
    },

    valueChange: function(which, textbox) {
        var doc = NoSquintSitePrefs.doc;
        doc.getElementById(which + '-zoom-slider').value = textbox.value;
    },

    buttonUseDefault: function(which) {
        var doc = NoSquintSitePrefs.doc;
        var [text, full] = NoSquintSitePrefs.NoSquint.getZoomDefaults();
        var input = doc.getElementById(which + '-zoom-level');
        input.value = which == 'text' ? text : full;
        input.onchange();
    },


    close: function() {
        var doc = NoSquintSitePrefs.doc;
        var browser = NoSquintSitePrefs.browser;
        var [text_current, full_current] = NoSquintSitePrefs.NoSquint.getLevelForBrowser(browser);
        var text = doc.getElementById('text-zoom-level').value;
        var full = doc.getElementById('full-zoom-level').value;
        if (text != text_current || full != full_current) {
            NoSquintSitePrefs.NoSquint.zoom(browser, text, full);
            NoSquintSitePrefs.NoSquint.saveCurrentZoom();
        }
        NoSquintSitePrefs.NoSquint.siteDialog = null;
        NoSquintSitePrefs.NoSquint = null;
    },

    cancel: function() {
        NoSquintSitePrefs.NoSquint.siteDialog = null;
    }
};
