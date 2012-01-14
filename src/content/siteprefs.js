var NoSquintSitePrefs = {
    prefs: null,
    browser: null,
    NoSquint: null,
    bundle: null,
    updateTimer: null,

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

        var update = function() { NoSquintSitePrefs.style(true, false); };
        doc.getElementById('colorBackgroundImages').addEventListener("CheckboxStateChange", update, false);
        doc.getElementById('linksUnderline').addEventListener("CheckboxStateChange", update, false);

        for each (var id in ['colorText', 'colorBackground', 'linksUnvisited', 'linksVisited']) {
            var cb = doc.getElementById(id);
            cb.addEventListener("CheckboxStateChange", NoSquintSitePrefs.colorChecked, false);
            var picker = cb.parentNode.childNodes[1];
            picker.onchange = function() {
                NoSquintSitePrefs.style(true, false);
            }
        }
    },

    colorChecked: function(event, cb) {
        cb = cb || this;
        var picker = cb.parentNode.childNodes[1];
        picker.disabled = !cb.checked;
        picker.style.opacity = cb.checked ? 1.0 : 0.2;
        if (event)
            // Only style() if we've been triggered by user checking the checkbox,
            // not a call from elsewhere in this file.
            NoSquintSitePrefs.style(true, false);
    },

    setValues: function(browser, site) {
        var doc = NoSquintSitePrefs.doc;
        if (NoSquintSitePrefs.NoSquint.rememberSites) {
            var [text, full] = NoSquintSitePrefs.NoSquint.getLevelForBrowser(browser);
            // We don't use getStyleForBrowser() because it also applies the default
            // values.
            var style = NoSquintSitePrefs.NoSquint.getStyleForSite(browser._noSquintSite);
            doc.getElementById('global-warning-box').style.display = 'none';
        } else {
            var text = Math.round(browser.markupDocumentViewer.textZoom * 100);
            var full = Math.round(browser.markupDocumentViewer.fullZoom * 100);
            var style = {text: '0', bg: '0', bgimages: false, unvisited: '0', visited: '0', underline: false};
            doc.getElementById('global-warning-box').style.display = '';
        }

        NoSquintSitePrefs.browser = browser;
        NoSquintSitePrefs.site = site;

        doc.getElementById('text-zoom-slider').value = text;
        doc.getElementById('full-zoom-slider').value = full;

        function setcolor(id, attr, def) {
            var cb = doc.getElementById(id);
            var picker = cb.parentNode.childNodes[1];
            picker.color = (style && style[attr] != '0') ? style[attr] : def;
            cb.checked = (style && style[attr] != '0') ? true : false;
            NoSquintSitePrefs.colorChecked(null, cb);
        }
        setcolor('colorText', 'text', '#000000');
        setcolor('colorBackground', 'bg', '#ffffff');
        setcolor('linksUnvisited', 'unvisited', '#0000ee');
        setcolor('linksVisited', 'visited', '#551a8b');
        doc.getElementById('colorBackgroundImages').checked = style ? style.bgimages : false;
        doc.getElementById('linksUnderline').checked = style ? style.underline : false;

        var caption = doc.getElementById('site').childNodes[0];
        //caption.label = NoSquintSitePrefs.bundle.getString('settingsFor') + " " + site;
        caption.label = site;
        window.sizeToContent();
    },

    sliderChange: function(which, slider) {
        var doc = NoSquintSitePrefs.doc;
        slider.value = parseInt(slider.value / 5) * 5;
        if (doc)
            doc.getElementById(which + '-zoom-level').value = slider.value;
        NoSquintSitePrefs.queueUpdateZoom();
        return 5;
    },

    valueChange: function(which, textbox) {
        var doc = NoSquintSitePrefs.doc;
        doc.getElementById(which + '-zoom-slider').value = textbox.value;
        NoSquintSitePrefs.queueUpdateZoom();
    },

    queueUpdateZoom: function() {
        if (NoSquintSitePrefs.updateTimer)
            return;
        NoSquintSitePrefs.updateTimer = setTimeout(function() { NoSquintSitePrefs.updateZoom(); }, 400);
    },

    updateZoom: function() {
        clearTimeout(NoSquintSitePrefs.updateTimer);
        NoSquintSitePrefs.updateTimer = null;
        NoSquintSitePrefs.zoom(true, false);
    },

    zoom: function(from_form, save) {
        var doc = NoSquintSitePrefs.doc;
        var browser = NoSquintSitePrefs.browser;
        if (from_form) {
            var text = doc.getElementById('text-zoom-level').value;
            var full = doc.getElementById('full-zoom-level').value;
        } else
            var [text, full] = NoSquintSitePrefs.NoSquint.getLevelForBrowser(browser);

        NoSquintSitePrefs.NoSquint.zoom(browser, text, full);
        if (save)
            NoSquintSitePrefs.NoSquint.saveCurrentZoom();
    },

    style: function(from_form, save) {
        var style = null;
        if (from_form) {
            var doc = NoSquintSitePrefs.doc;
            style = {};
            for each (var [id, attr] in [['colorText', 'text'], ['colorBackground', 'bg'], 
                                ['linksUnvisited', 'unvisited'], ['linksVisited', 'visited']]) {
                var cb = doc.getElementById(id);
                var picker = cb.parentNode.childNodes[1];
                style[attr] = cb.checked ? picker.color : '0';
            }
            style.bgimages = doc.getElementById("colorBackgroundImages").checked;
            style.underline = doc.getElementById("linksUnderline").checked;
        }
        if (save)
            NoSquintSitePrefs.NoSquint.updateSiteList(NoSquintSitePrefs.site, null, style);
        if (style)
            style = NoSquintSitePrefs.NoSquint.applyStyleDefaults(style);
        // FIXME: we've already updated site list from zoom, so we're doing it twice.
        NoSquintSitePrefs.NoSquint.style(NoSquintSitePrefs.browser, style);
        NoSquintSitePrefs.NoSquint.updateStatus();
    },

    buttonUseDefault: function(which) {
        var doc = NoSquintSitePrefs.doc;
        var [text, full] = NoSquintSitePrefs.NoSquint.getZoomDefaults();
        var input = doc.getElementById(which + '-zoom-level');
        input.value = which == 'text' ? text : full;
        input.onchange();
    },


    close: function() {
        NoSquintSitePrefs.zoom(true, true);
        NoSquintSitePrefs.style(true, true);
        NoSquintSitePrefs.NoSquint.siteDialog = null;
        NoSquintSitePrefs.NoSquint = null;
    },

    cancel: function() {
        //var [text_current, full_current] = NoSquintSitePrefs.NoSquint.getLevelForBrowser(browser);
        //NoSquintSitePrefs.zoom(text_current, full_current, false);
        NoSquintSitePrefs.zoom(false, false);
        NoSquintSitePrefs.style(false, false);
        NoSquintSitePrefs.NoSquint.siteDialog = null;
    }
};
