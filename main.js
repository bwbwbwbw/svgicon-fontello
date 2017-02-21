#!/usr/bin/env node

const argv = require('yargs')
  .demandCommand(1)
  .argv;

const svgfont = argv._[0];

const _ = require('lodash');
const fs = require('fs');
const request = require('request-promise-native');
const Zip = require('adm-zip');
const tmp = require('tmp');
const moment = require('moment');
const fontBlast = require('font-blast');
const open = require('open');
const path = require('path');

const XMLDOMParser = require('xmldom').DOMParser;
const SvgPath = require('svgpath');

// from fontello
function uid() {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, function () {
    return ((Math.random() * 16) | 0).toString(16);
  });
}

// https://github.com/fontello/fontello/blob/a59530d22caf13eadbe308c1d27dcefb54e8d83b/client/fontello/app/import/import.js
// from fontello
function import_svg_font(data/*, file*/) {
  var xmlDoc = (new XMLDOMParser()).parseFromString(data, 'application/xml');

  var customIcons = [];

  var allocatedRefCode = 0xe800;

  var svgFont = xmlDoc.getElementsByTagName('font')[0];
  var svgFontface = xmlDoc.getElementsByTagName('font-face')[0];
  var svgGlyps = xmlDoc.getElementsByTagName('glyph');

  var fontHorizAdvX = svgFont.getAttribute('horiz-adv-x');
  var fontAscent = svgFontface.getAttribute('ascent');
  var fontUnitsPerEm = svgFontface.getAttribute('units-per-em') || 1000;

  var scale = 1000 / fontUnitsPerEm;

  _.each(svgGlyps, function (svgGlyph) {
    var d = svgGlyph.getAttribute('d');

    // FIXME
    // Now just ignore glyphs without image, however
    // that can be space. Does anyone needs it?
    if (!d) { return; }


    var glyphCodeAsChar = svgGlyph.getAttribute('unicode');

    var glyphCode = allocatedRefCode++;
    var glyphName = svgGlyph.getAttribute('glyph-name') || 'glyph';
    var glyphHorizAdvX =  svgGlyph.hasAttribute('horiz-adv-x') ? svgGlyph.getAttribute('horiz-adv-x') : fontHorizAdvX;

    if (!glyphHorizAdvX) { return; } // ignore zero-width glyphs

    var width = glyphHorizAdvX * scale;

    // Translate font coonds to single SVG image coords
    d = new SvgPath(d)
              .translate(0, -fontAscent)
              .scale(scale, -scale)
              .abs()
              .round(1)
              .toString();

    customIcons.push({
      css:     glyphName,
      code:    glyphCode,
      search:  [ glyphName ],
      svg: {
        path:  d,
        width
      }
    });
  });

  return customIcons;
}

function main() {
  let config;
  return Promise.resolve()
    .then(() => {
      let icons;
      try {
        icons = import_svg_font(fs.readFileSync(svgfont, 'utf8'));
        console.log('Extracted %d icons: %s', icons.length, icons.map(icon => icon.css).join(', '));
      } catch (err) {
        console.error('Failed to extract svg icons from svg font.');
        throw err;
      }
      return icons;
    })
    .then((icons) => {
      config = {
        name: "fontello",
        css_prefix_text: "icon-",
        css_use_suffix: false,
        hinting: true,
        units_per_em: 1000,
        ascent: 850,
      };
      config.glyphs = icons.map(icon => {
        if (icon.svg.width !== 1000) {
          console.warn('Warn: icon "%s" width !== 1000', icon.css);
        }
        return _.assign({
          uid: uid(),
          src: 'custom_icons',
          selected: true,
        }, icon);
      });
    })
    .then(() => {
      console.log('Sending request to fontello...');
      return request.post({
        url: 'http://fontello.com',
        formData: {
          config: {
            value: Buffer.from(JSON.stringify(config)),
            options: {
              contentType: 'application/json',
              filename: 'config.json',
            },
          },
        },
      });
    })
    .then((session_id) => {
      console.log('Fontello session_id = %s', session_id);
      console.log('Downloading processed fonts from fontello...');
      return request.get({
        url: `http://fontello.com/${session_id}/get`,
        encoding: null,
      });
    })
    .then((body) => {
      console.log('Extracting svgfont from zip...');
      const zip = new Zip(body);
      const zipEntries = zip.getEntries();
      let svgfont = null;
      zipEntries.forEach(function(zipEntry) {
        //console.log(zipEntry.name);
        if (zipEntry.name === 'fontello.svg') {
          //console.log(zipEntry.data);
          svgfont = zipEntry.getData();
        }
      });
      if (!svgfont) {
        throw new Error('Failed to extract svgfont from fontello downloaded zip file.');
      }
      var tmpFile = tmp.fileSync().name;
      fs.writeFileSync(tmpFile, svgfont);
      return tmpFile;
    })
    .then((svgFontFile) => {
      console.log('Extracting svg icons...');
      const destDirectory = argv._[1] || ('./svg_' + moment().format('YYYY-MM-DD-HH-mm-ss'));
      fontBlast(svgFontFile, destDirectory);
      console.log('Svg icons extracted to: %s', destDirectory);
      open(path.resolve(destDirectory, 'svg/'));
    })
  ;
}

main().catch(err => {
  console.error(err);
});
