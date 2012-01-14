NoSquint.dialogs.help = NoSquint.ns(function() { with (NoSquint) {
    this.init = function() {
        var browser = $('nosquint-help-browser');
        var uri = 'chrome://nosquint/locale/help.html';
        if (window.arguments)
            uri += '#' + window.arguments[0];
        browser.loadURI(uri, null, null);
    };

}});
