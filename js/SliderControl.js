/* SliderControl.js — Leaflet + jQuery UI time slider control
 * Works with layers whose markers (or vector layers) carry a time property
 * either in feature.properties[timeAttribute] or layer.options[timeAttribute].
 * The time can be a string, a Date, or (if isEpoch=true) seconds/millis since epoch.
 */
L.Control.SliderControl = L.Control.extend({
  options: {
    position: 'topright',
    layer: null,                 // L.LayerGroup or L.FeatureGroup with child layers
    timeAttribute: 'time',       // property name carrying the time
    isEpoch: false,              // if true, interpret numeric values as epoch (ms or s)
    startTimeIdx: 0,             // substring start for display
    timeStrLength: 19,           // substring length for display
    maxValue: -1,
    minValue: 0,
    showAllOnStart: false,
    markers: null,               // populated internally
    range: false,                // use jQuery UI range mode
    follow: 0,                   // if > 0, show trailing N steps up to value
    sameDate: false,             // show all markers matching the same timestamp
    alwaysShowDate: false,       // keep timestamp pill visible
    rezoom: null,                // if set, fitBounds with this maxZoom on slide
    orderMarkers: true,          // sort markers by time
    orderDesc: false,            // reverse order
    popupOptions: {},
    popupContent: '',
    showAllPopups: true,         // keep multiple popups open
    showPopups: true             // open popups when markers shown
  },

  initialize: function (options) {
    L.Util.setOptions(this, options);
    this._layer = this.options.layer;
    L.extend(this, L.Mixin.Events);
  },

  onAdd: function (map) {
    this.options.map = map;

    // Root container
    this.container = L.DomUtil.create('div', 'leaflet-control-slider');
    this.sliderBoxContainer = L.DomUtil.create('div', 'slider', this.container);

    // Inner element jQuery UI will attach to
    this.sliderContainer = L.DomUtil.create('div', '', this.sliderBoxContainer);
    this.sliderContainer.id = 'leaflet-slider';
    this.sliderContainer.style.width = '200px';

    // Timestamp pill (hidden until needed unless alwaysShowDate)
    this.timestampContainer = L.DomUtil.create('div', 'slider', this.container);
    this.timestampContainer.id = 'slider-timestamp';
    this.timestampContainer.style.cssText =
      'width:200px;margin-top:3px;background-color:#FFFFFF;text-align:center;border-radius:5px;display:none;';

    // Prevent map interactions while using the slider
    L.DomEvent.disableClickPropagation(this.sliderBoxContainer);
    this._map = map;
    this._map.on('mouseup', this.clearTimestamp, this);

    // Prepare markers array
    var options = this.options;
    options.markers = [];

    // Helper to compare two layers by their time value
    function compare(a, b) {
      var valA = getTimeValueFromLayer(a, options);
      var valB = getTimeValueFromLayer(b, options);
      if (valA == null || valB == null) return 0;
      return valA < valB ? -1 : valA > valB ? 1 : 0;
    }

    // Extracts comparable value (number) for sorting; falls back to string
    function getTimeValueFromLayer(layer, opts) {
      var raw = getRawTime(layer, opts);
      if (raw == null) return null;
      if (raw instanceof Date) return raw.getTime();
      if (typeof raw === 'number') {
        // If isEpoch=false but number appears epoch-like, still sortable
        return raw < 1e12 ? raw * 1000 : raw; // seconds → ms heuristic
      }
      // string → Date.parse
      var t = Date.parse(raw);
      return isNaN(t) ? null : t;
    }

    if (this._layer) {
      // Flatten any LayerGroups to a linear array
      var tempLayers = [];
      this._layer.eachLayer(function (layer) {
        tempLayers.push(layer);
      });

      if (options.orderMarkers) {
        tempLayers = tempLayers.sort(compare);
        if (options.orderDesc) tempLayers.reverse();
      }

      var that = this;
      var idx = 0;
      tempLayers.forEach(function (layer) {
        if (layer instanceof L.LayerGroup) {
          layer.getLayers().forEach(function (l) {
            that._stashPopup(l);
          });
        } else {
          that._stashPopup(layer);
        }
        options.markers[idx++] = layer;
      });

      options.maxValue = idx - 1;
      this.options = options;
    } else {
      console.error('SliderControl: you must pass { layer: yourLayerGroup }');
    }

    return this.container;
  },

  onRemove: function (map) {
    // Remove all markers that might have been added by slider
    for (var i = this.options.minValue; i <= this.options.maxValue; i++) {
      if (this.options.markers[i]) map.removeLayer(this.options.markers[i]);
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this._map) {
      this._map.off('mouseup', this.clearTimestamp, this);
    }
  },

  startSlider: function () {
    var _options = this.options;
    var that = this;

    var indexStart = _options.minValue;
    if (_options.showAllOnStart) {
      indexStart = _options.maxValue;
      if (_options.range) _options.values = [_options.minValue, _options.maxValue];
      else _options.value = _options.maxValue;
    }

    var timestampContainer = this.timestampContainer;

    // Initialize jQuery UI slider on the INNER element
    $(this.sliderContainer).slider({
      range: _options.range,
      value: _options.value,
      values: _options.values,
      min: _options.minValue,
      max: _options.maxValue,
      step: 1,
      slide: function (_e, ui) {
        var map = _options.map;
        var fg = L.featureGroup();
        var markersToShow = [];
        var currentIdx = _options.range ? ui.values[1] : ui.value;

        // Show timestamp
        var ts = getRawTime(_options.markers[currentIdx], _options);
        if (ts != null) {
          timestampContainer.style.display = 'block';
          $(timestampContainer).html(formatTimestamp(ts, _options));
        }

        // Clear all layers first
        for (var i = _options.minValue; i <= _options.maxValue; i++) {
          if (_options.markers[i]) map.removeLayer(_options.markers[i]);
        }

        if (_options.range) {
          for (var r = ui.values[0]; r <= ui.values[1]; r++) {
            if (_options.markers[r]) {
              markersToShow.push(_options.markers[r]);
              map.addLayer(_options.markers[r]); fg.addLayer(_options.markers[r]);
            }
          }
        } else if (_options.follow > 0) {
          for (var f = currentIdx - _options.follow + 1; f <= currentIdx; f++) {
            if (_options.markers[f]) {
              markersToShow.push(_options.markers[f]);
              map.addLayer(_options.markers[f]); fg.addLayer(_options.markers[f]);
            }
          }
        } else if (_options.sameDate) {
          var curTime = getRawTimeValue(_options.markers[currentIdx], _options);
          for (var s = _options.minValue; s <= _options.maxValue; s++) {
            if (getRawTimeValue(_options.markers[s], _options) === curTime) {
              markersToShow.push(_options.markers[s]);
              map.addLayer(_options.markers[s]); fg.addLayer(_options.markers[s]);
            }
          }
        } else {
          for (var k = _options.minValue; k <= currentIdx; k++) {
            if (_options.markers[k]) {
              markersToShow.push(_options.markers[k]);
              map.addLayer(_options.markers[k]); fg.addLayer(_options.markers[k]);
            }
          }
        }

        if (_options.showPopups) that._openPopups(markersToShow);
        that.fire('rangechanged', { markers: markersToShow });

        if (_options.rezoom && fg.getLayers().length) {
          map.fitBounds(fg.getBounds(), { maxZoom: _options.rezoom });
        }
      }
    });

    // Initial timestamp pill (if requested)
    if (_options.alwaysShowDate && _options.markers[indexStart]) {
      var initialTs = getRawTime(_options.markers[indexStart], _options);
      if (initialTs != null) {
        timestampContainer.style.display = 'block';
        $(timestampContainer).html(formatTimestamp(initialTs, _options));
      }
    }

    // Show initial set of markers
    var initialMarkers = [];
    for (var i = _options.minValue; i <= indexStart; i++) {
      if (_options.markers[i]) {
        initialMarkers.push(_options.markers[i]);
        _options.map.addLayer(_options.markers[i]);
      }
    }
    if (_options.showPopups) this._openPopups(initialMarkers);
    this.fire('rangechanged', { markers: initialMarkers });
  },

  clearTimestamp: function () {
    if (!this.options.alwaysShowDate) {
      this.timestampContainer.innerHTML = '';
      this.timestampContainer.style.display = 'none';
    }
  },

  setPosition: function (position) {
    var map = this._map;
    if (map) map.removeControl(this);
    this.options.position = position;
    if (map) map.addControl(this);
    this.startSlider();
    return this;
  },

  // Preserve original popup so we can reopen later
  _stashPopup: function (marker) {
    if (marker && marker._popup) marker._orgpopup = marker._popup;
    return marker;
  },

  _openPopups: function (markers) {
    var options = this.options;
    var that = this;
    markers.forEach(function (m) {
      if (!m) return;
      if (m instanceof L.LayerGroup) {
        that._openPopups(m.getLayers());
        return;
      }
      if (m._orgpopup) {
        m._popup = m._orgpopup;
        if (options.showAllPopups) m._popup.options.autoClose = false;
        m.openPopup();
      } else if (options.popupContent) {
        var popupOptions = L.Util.extend({}, options.popupOptions);
        if (options.showAllPopups) popupOptions.autoClose = false;
        m.bindPopup(options.popupContent, popupOptions).openPopup();
      }
    });
  }
});

/* --------- helper functions (module-local) --------- */

// Get the raw time value (string | Date | number) from a layer
function getRawTime(layer, options) {
  if (!layer) return null;
  var t = null;
  if (layer.feature && layer.feature.properties && layer.feature.properties[options.timeAttribute] != null) {
    t = layer.feature.properties[options.timeAttribute];
  } else if (layer.options && layer.options[options.timeAttribute] != null) {
    t = layer.options[options.timeAttribute];
  }
  return t;
}

// Get a canonical scalar time value for equality checks (stringified)
function getRawTimeValue(layer, options) {
  var t = getRawTime(layer, options);
  if (t instanceof Date) return t.toISOString();
  if (typeof t === 'number') return options.isEpoch ? normalizeEpoch(t).toISOString() : new Date(t).toISOString();
  return String(t);
}

// Normalize epoch seconds/millis to Date
function normalizeEpoch(n) {
  // treat <1e12 as seconds; >=1e12 as millis
  if (n < 1e12) n = n * 1000;
  return new Date(n);
}

// Formats the timestamp for display in the pill
function formatTimestamp(time, options) {
  let d;
  if (time instanceof Date) {
    d = time;
  } else if (typeof time === 'number') {
    // If isEpoch, interpret as epoch; otherwise assume millis
    d = options.isEpoch ? normalizeEpoch(time) : new Date(time);
  } else if (typeof time === 'string') {
    // string can be "YYYY", "YYYY-MM-DD", ISO, etc.
    const yMatch = time.match(/^(\d{4})/);
    if (yMatch) return yMatch[1];   // <-- return the first 4 chars if they are a year
    d = new Date(time);
  }

// Factory
L.control.sliderControl = function (options) {
  return new L.Control.SliderControl(options);
};
