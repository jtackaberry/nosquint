NoSquint.dialogs.site = NoSquint.ns(function() { with (NoSquint) {
    this.strings = getStringBundle('dlg-site');

    var updateTimer = null;

    this.init = function() {
        NSQ.storage.dialogs.site = this;
        this.dlg = $('nosquint-dialog-site');

        this.setBrowser(window.arguments[0], window.arguments[1]);

        $('full-zoom-level').onchange = function() NSQ.dialogs.site.valueChange(this);
        $('text-zoom-level').onchange = function() NSQ.dialogs.site.valueChange(this);

        var restyle = function() NSQ.dialogs.site.style(true, false);
        for (let id in NSQ.browser.prefs.defaultColors) {
            $(id).addEventListener('CheckboxStateChange', this.colorChecked, false);
            $(id).parentNode.childNodes[1].onchange = restyle;
        }
        $('colorBackgroundImages').addEventListener('CheckboxStateChange', restyle, false);
        $('linksUnderline').addEventListener('CheckboxStateChange', restyle, false);
    };


    // Immediately dismiss window.  Used when transitioning from Private Browsing mode.
    this.die = function() {
        this.finalize();
        window.close();
    };

    this.cancel = function() {
        this.revert();
        this.finalize();
    };

    this.close = function() {
        this.zoom(true, true);
        this.style(true, true);
        this.finalize();
    };

    this.finalize = function() {
        NSQ.storage.dialogs.site = null;
    };

    this.discoverSiteNameChange = function() {
        var site = this.browser.getUserData('nosquint').site;
        if (site != this.site)
            this.setBrowser(NSQ.browser, this.browser);
    };

    this.setBrowser = function(nsqBrowser, mozBrowser) {
        var site = mozBrowser.getUserData('nosquint').site;
        if (this.site) {
            if (this.browser != mozBrowser || this.site != site)
                // Settings opened for new site, revert any changes for last site.
                this.revert();
            else {
                // Everything is the same.
                window.focus();
                return;
            }
        }

        NSQ.browser = nsqBrowser;
        this.browser = mozBrowser;
        this.site = site;

        var [text, full] = NSQ.browser.getZoomForBrowser(this.browser);
        var style = NSQ.browser.prefs.getStyleForSite(this.site);

        this.updateWarning();

        $('caption').label = this.site;
        $('text-zoom-slider').value = text;
        $('full-zoom-slider').value = full;

        for (let [id, defcolor] in items(NSQ.browser.prefs.defaultColors)) {
            $(id).parentNode.childNodes[1].color = (!style || style[id] == '0' ? defcolor : style[id]);
            $(id).checked = Boolean(style && style[id] && style[id] != '0');
            this.colorChecked.apply($(id));
        }
        for (let attr in iter(['colorBackgroundImages', 'linksUnderline']))
            $(attr).checked = Boolean(style && style[attr] && style[attr] != '0');
        window.focus();
        window.sizeToContent();
    };

    this.updateWarning = function() {
        var content = null;
        if (NSQ.browser.isPrivate)
            content = this.strings.warningPrivateBrowsing;
        else if (!NSQ.browser.prefs.rememberSites)
            content = this.strings.warningForgetSites;

        $('warning-box-content').innerHTML = content;
        $('warning-box').style.display = content ? '' : 'none';
        window.sizeToContent();
    };

    this.revert = function() {
        this.zoom(false, false);
        this.style(false, false);
    };


    this.openGlobalSettings = function() {
        NSQ.cmd.openGlobalSettings(this.browser);
    };


    // Callback when text/full zoom text input is changed.
    this.valueChange = function(target) {
        $(target.id.replace('level', 'slider')).value = target.value;
        this.queueUpdateZoom();
    };

    // Callback when text/full zoom slider is changed.
    this.sliderChange = function(target) {
        // Snap to increments of 5.
        target.value = parseInt(target.value / 5) * 5;
        // Sync slider value to text input field.
        $(target.id.replace('slider', 'level')).value = target.value;
        this.queueUpdateZoom();
    };

    this.buttonUseDefault = function(target) {
        var [text, full] = NSQ.browser.prefs.getZoomDefaults(this.site);
        var input = $(target.id.replace('button', 'level'));
        input.value = (input.id == 'text-zoom-level' ? text : full);
        input.onchange();
    };

    this.queueUpdateZoom = function() {
        if (updateTimer)
            return;
        updateTimer = setTimeout(function() {
            clearTimeout(updateTimer);
            updateTimer = null;
            NSQ.dialogs.site.zoom(true, false);
        }, 400);
    };

    this.zoom = function(fromForm, save) {
        var text = fromForm ? $('text-zoom-level').value : null;
        var full = fromForm ? $('full-zoom-level').value : null;
        NSQ.browser.zoom(this.browser, text, full);
        if (save)
            NSQ.browser.prefs.updateSiteList(this.site, [text, full]);
    };


    this.colorChecked = function(event) {
        // Color picker button is enabled if the checkbox beside is is on.
        var picker = this.parentNode.childNodes[1];
        picker.disabled = !this.checked;
        picker.style.opacity = this.checked ? 1.0 : 0.2;
        if (event)
            // Only style() if we've been triggered by user checking the checkbox,
            // not a call from elsewhere in this file.
            NSQ.dialogs.site.style(true, false);
    };

    this.style = function(fromForm, save) {
        var style = null;
        if (fromForm) {
            var style = {enabled: false};
            for (let attr in iter(NSQ.browser.prefs.defaultColors)) {
                style[attr] = $(attr).checked ? $(attr).parentNode.childNodes[1].color : null;
                style.enabled = style.enabled || Boolean(style[attr]);
            }
            for (let attr in iter(['colorBackgroundImages', 'linksUnderline'])) {
                style[attr] = Boolean($(attr).checked);
                style.enabled = style.enabled || Boolean(style[attr]);
            }
        }
        if (save)
            NSQ.browser.prefs.updateSiteList(this.site, null, style);
        if (style)
            style = NSQ.browser.prefs.applyStyleGlobals(style);

        NSQ.browser.style(this.browser, style);
    };


}});
