/* SliderControl.js — Leaflet + jQuery UI time slider control
 * Shows time-series layers on a Leaflet map.
 * Modified so the timestamp pill displays ONLY the 4-digit year.
 */
L.Control.SliderControl = L.Control.extend({
  options: {
    position: 'topright',
    layer: null,
    timeAttribute: 'time',
    isEpoch: false,
    startTimeIdx: 0,
    timeStrLength: 19,
    maxValue: -1,
    minValue: 0,
    showAllOnStart: false,
    markers: null,
    range: false,
    follow: 0,
    sameDate: false,
    alwaysShowDate: false,
    rezoom: null,
    orderMarkers: true,
    orderDesc: false,
    popupOptions: {},
    popupContent: '',
    showAllPopups: true,
    showPopups: true
  },

  initialize: function (options) {
    L.Util.setOptions(this, options);
    this._layer = this.options.layer;
    L.extend(this, L.Mixin.Events);
  },

  onAdd: function (map) {
    this.options.map = map;

    this.container = L.DomUtil.create('div', 'leaflet-control-slider');
    this.sliderBoxContainer = L.DomUtil.create('div', 'slider', this.container);

    this.sliderContainer = L.DomUtil.create('div', '', this.sliderBoxContainer);
    this.sliderContainer.id = 'leaflet-slider';
    this.sliderContainer.style.width = '200px';

    this.timestampContainer = L.DomUtil.create('div', 'slider', this.container);
    this.timestampContainer.id = 'slider-timestamp';
    this.timestampContainer.style.cssText =
      'width:200px;margin-top:3px;background-color:#FFFFFF;text-align:center;border-radius:5px;display:none;';

    L.DomEvent.disableClickPropagation(this.sliderBoxContainer);
    this._map = map;
    this._map.on('mouseup', this.clearTimestamp, this);

    var options = this.options;
    options.markers = [];

    function getTimeValueFromLayer(layer, options) {
      var raw = getRawTime(layer, options);
      if (raw == null) return null;
      if (raw instanceof Date) return raw.getTime();
      if (typeof raw === 'number') {
        return raw < 1e12 ? raw * 1000 : raw;
      }
      var t = Date.parse(raw);
      return isNaN(t) ? null : t;
    }

    function compare(a, b) {
      var valA = getTimeValueFromLayer(a, options);
      var valB = getTimeValueFromLayer(b, options);
      if (valA == null || valB == null) return 0;
      return valA < valB ? -1 : valA > valB ? 1 : 0;
    }

    if (this._layer) {
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

        var ts = getRawTime(_options.markers[currentIdx], _options);
        if (ts != null) {
          timestampContainer.style.display = 'block';
          $(timestampContainer).html(formatTimestamp(ts, _options));
        }

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

    if (_options.alwaysShowDate && _options.markers[indexStart]) {
      var initialTs = getRawTime(_options.markers[indexStart], _options);
      if (initialTs != null) {
        timestampContainer.style.display = 'block';
        $(timestampContainer).html(formatTimestamp(initialTs, _options));
      }
    }

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

/* --------- helper functions --------- */

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

function getTimeValueFromLayer(layer, options) {
  var raw = getRawTime(layer, options);
  if (raw == null) return null;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number') {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  var t = Date.parse(raw);
  return isNaN(t) ? null : t;
}

function normalizeEpoch(n) {
  if (n < 1e12) n = n * 1000;
  return new Date(n);
}

// force timestamp pill to show year only
function formatTimestamp(time, options) {
  let d;
  if (time instanceof Date) {
    d = time;
  } else if (typeof time === 'number') {
    d = options.isEpoch ? normalizeEpoch(time) : new Date(time);
  } else if (typeof time === 'string') {
    const yMatch = time.match(/^(\d{4})/);
    if (yMatch) return yMatch[1];
    d = new Date(time);
  }
  if (!d || isNaN(d.getTime())) return '';
  return String(d.getUTCFullYear());
}

L.control.sliderControl = function (options) {
  return new L.Control.SliderControl(options);
};
