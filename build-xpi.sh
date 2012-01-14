#!/bin/bash

[ ! -f "src/install.rdf" ] && {
    echo src/install.rdf is not found
    exit 1
}

version=`cat "src/install.rdf" | grep "em:version" | sed 's/.*version>\(.*\)<.*/\1/'`
[ -z "$version" ] && {
    echo Unable to determine version.
    exit 1
}

mkdir -p dist
cp -a src dist/$version.$$
pushd dist/$version.$$
find -name '.*.swp' -exec rm -f {} \;
cat chrome.manifest.in | sed 's/${JAR}/jar:chrome\/nosquint.jar!\//' > chrome.manifest
rm -f chrome.manifest.in
mkdir chrome
zip -9 -r chrome/nosquint.jar content locale skin
rm -rf content locale skin
rm -f ../nosquint-$version.xpi
zip -9 -r ../nosquint-$version.xpi *
popd
rm -rf dist/$version.$$

echo Packaged dist/nosquint-$version.xpi
