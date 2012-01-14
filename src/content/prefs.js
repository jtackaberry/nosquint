function domains_rb_select(doc) {
    var label = doc.getElementById("domainZoom-label");
    if (!window.arguments || window.arguments[0] == "") {
        if (label.value.search("\\(") == -1)
            label.value = label.value.replace(":", " ([no domain in URL])");
        return;
    }
    var box = doc.getElementById("domainZoom-box");
    var disabled = doc.getElementById("rememberDomains").selectedIndex == 0;
    if (label.value.search("\\(") == -1) {
        label.value = label.value.replace(":", " (" + window.arguments[0] + "):");
        doc.getElementById("domainZoom").value = window.arguments[1];
    }

    for (i = 0; i < box.childNodes.length; i++)
        box.childNodes[i].disabled = disabled;
    doc.getElementById("domainZoom-button").disabled = disabled;
    //doc.getElementById("domainZoom-grid").hidden = false;
}

function domains_use_default(doc) {
    window.arguments[1] = "default";
    doc.getElementById("domainZoom").value = "default";
}
