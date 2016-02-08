var system = require('system')
  , page = require('webpage').create()
  , fs = require('fs')
  , optUtils = require('./options');

// Read in arguments
var site = system.args[1];
var path = system.args.length == 4 ? null : system.args[2];
var streaming = ((system.args.length == 4 ? system.args[2] : system.args[3]) === 'true');
var options = JSON.parse(system.args.length == 4 ? system.args[3] : system.args[4]);

page.viewportSize = {
  width: options.windowSize.width * options.pixelRatio
, height: options.windowSize.height * options.pixelRatio
};

page.onConsoleMessage = function(msg) {
    console.log(msg);
};

// Here we block the first (few) requests until we have set the correct window variables
var resources = [];
page.onResourceRequested = function(requestData, networkRequest) {
    if((requestData.url.match(/\.js/g) !== null || requestData.url.match(/\/js\//g) !== null)) {
        if(requestData.url.match(/_phantomLoadMe/g) === null && requestData.url.match(/typekit/gi) === null) {
            console.log('Temporarily blocking too soon request to ', requestData['url']);
            resources.push(requestData['url']);
            networkRequest.abort();
        }
    }

    var reqUrl = requestData.url;
    var newUrl = requestData.url.split(',%20')[0];

    if (newUrl != reqUrl) {
      networkRequest.changeUrl(newUrl);
    }
};


// Capture JS errors and write them to stderr
page.onError = function(msg, trace) {
  var msgStack = ['ERROR: ' + msg];

  if (trace && trace.length) {
    msgStack.push('TRACE:');
    trace.forEach(function(t) {
      msgStack.push(' -> ' + t.file + ': ' + t.line + (t.function ? ' (in function "' + t.function +'")' : ''));
    });
  }

  system.stderr.write(msgStack.join('\n'));
};

if (options.errorIfStatusIsNot200) {
  page.onResourceReceived = function(response) {
    // If request to the page is not 200 status, fail.
    if (response.url === site && response.status !== 200) {
      system.stderr.write('Status must be 200; is ' + response.status);
      page.close();
      phantom.exit(0);
    }
  };
}

// Handle cookies
if (Array.isArray(options.cookies)) {
  for (var i=0; i<options.cookies.length; ++i) {
    phantom.addCookie(options.cookies[i]);
  }
} else if (options.cookies === null) {
  phantom.cookiesEnabled = false;
}

// Register user-provided callbacks
optUtils.phantomCallback.forEach(function(cbName) {
  var cb = options[cbName];

  if (cbName === 'onCallback' && options.takeShotOnCallback) return;
  if (cbName === 'onLoadFinished' && !options.takeShotOnCallback) return;

  if (cb) {
    page[cbName] = buildEvaluationFn(cb.fn, cb.context);
  }
})

// Set the phantom page properties
var toOverwrite = optUtils.mergeObjects(
  optUtils.filterObject(options, optUtils.phantomPage)
, page);

optUtils.phantomPage.forEach(function(key) {
  if (toOverwrite[key]) page[key] = toOverwrite[key];
});

// The function that actually performs the screen rendering
var _takeScreenshot = function(status) {
  if (status === 'fail') {
    page.close();
    phantom.exit(1);
    return;
  }

  // Wait `options.renderDelay` seconds for the page's JS to kick in
  window.setTimeout(function () {

        page.evaluate(function (r, urls, width, height) {
            console.log('Setting window.devicePixelRatio to ' + r);
            window.devicePixelRatio = r;
            window.onload = false;
            window.innerWidth = (width/r);
            window.innerHeight = (height/r);
            document.documentElement.offsetWidth = (document.documentElement.offsetWidth/r);
            document.documentElement.offsetHeight = (document.documentElement.offsetHeight/r);
            document.documentElement.clientWidth = (document.documentElement.clientWidth/r);
            document.documentElement.clientHeight = (document.documentElement.clientHeight/r);
            screen.width = width;
            screen.height = height;
            document.body.style.webkitTransform = "scale(" + r + ")";
            document.body.style.webkitTransformOrigin = "0% 0%";
            document.body.style.width = (100 / r) + "%";

            // Now that we've set our window, let's get those scripts again
            var _phantomReexecute = [];
            var _phantomScripts = document.getElementsByTagName("script");
            _phantomScripts = Array.prototype.slice.call(_phantomScripts);
            if(_phantomScripts.length > 0) {
                _phantomScripts.forEach(function(v) {
                    if('src' in v && v.src !== "" && v.src.match(/typekit/gi) === null) {
                        urls.push(v.src);
                    }
                    else {
                        _phantomReexecute.push({'script': v.innerHTML});
                    }
                });
            }
            var _phantomAll = document.getElementsByTagName("script");
            for (var _phantomIndex = _phantomAll.length - 1; _phantomIndex >= 0; _phantomIndex--) {
                if(_phantomAll[_phantomIndex].src.match(/typekit/gi) === null) {
                    _phantomAll[_phantomIndex].parentNode.removeChild(_phantomAll[_phantomIndex]);
                }
            }
            var _phantomHead = document.getElementsByTagName("head")[0];
            if(urls.length > 0) {
                urls.forEach(function(u) {
                    var _phantomScript = document.createElement("script");
                    _phantomScript.type = "text/javascript";
                    _phantomScript.src = u + '?_phantomLoadMe';
                    _phantomHead.appendChild(_phantomScript);
                });
            }
            if(_phantomReexecute.length > 0) {
                _phantomReexecute.forEach(function(s) {
                    var _phantomScript = document.createElement("script");
                    _phantomScript.type = "text/javascript";
                    _phantomScript.innerHTML = s.script;
                    _phantomHead.appendChild(_phantomScript);
                });
            }

            // Make sure to execute onload scripts
            var _phantomCount = 0;
            var _phantomIntVal = setInterval(function() {
                if(window.onload !== false && window.onload !== null) {
                    window.onload();
                    clearInterval(_phantomIntVal);
                }
                _phantomCount++;

                if(_phantomCount > 10) {
                    clearInterval(_phantomIntVal);
                }
            }, 100);
        }, options.pixelRatio, resources, page.viewportSize.width, page.viewportSize.height);


    // Handle customCSS option
    if (options.customCSS) {
      page.evaluate(function(customCSS) {
        var style = document.createElement('style');
        var text  = document.createTextNode(customCSS);
        style.setAttribute('type', 'text/css');
        style.appendChild(text);
        document.head.insertBefore(style, document.head.firstChild);
      }, options.customCSS);
    }

    if (options.captureSelector) {

      // Handle captureSelector option
      page.clipRect = page.evaluate(function(selector) {
        try {
          var selectorClipRect =
            document.querySelector(selector).getBoundingClientRect();

          return {
              top: selectorClipRect.top
            , left: selectorClipRect.left
            , width: selectorClipRect.width
            , height: selectorClipRect.height
          };
        } catch (e) {
          throw new Error("Unable to fetch bounds for element " + selector);
        }
      }, options.captureSelector);
    } else {

      //Set the rectangle of the page to render
      page.clipRect = {
        top: options.shotOffset.top
      , left: options.shotOffset.left
      , width: pixelCount(page, 'width', options.shotSize.width)
          - options.shotOffset.right
      , height: pixelCount(page, 'height', options.shotSize.height)
          - options.shotOffset.bottom
      };
    }

    // Handle defaultWhiteBackgroud option
    if (options.defaultWhiteBackground) {
      page.evaluate(function() {
        var style = document.createElement('style');
        var text  = document.createTextNode('body { background: #fff }');
        style.setAttribute('type', 'text/css');
        style.appendChild(text);
        document.head.insertBefore(style, document.head.firstChild);
      });
    }

    // Render, clean up, and exit
    if (!streaming) {
      page.render(path, {quality: options.quality});
    } else {
      console.log(page.renderBase64(options.streamType));
    }

    page.close();
    phantom.exit(0);
  }, options.renderDelay);
}

// Avoid overwriting the user-provided onPageLoaded or onCallback options
var takeScreenshot;

if (options.onCallback && options.takeShotOnCallback) {
  takeScreenshot = function(data) {
    buildEvaluationFn(
      options.onCallback.fn
    , options.onCallback.context)(data);

    if (data == 'takeShot') {
      _takeScreenshot();
    }
  };
} else if (options.onLoadFinished && !options.takeShotOnCallback) {
  takeScreenshot = function(status) {
    buildEvaluationFn(
      options.onLoadFinished.fn
    , options.onLoadFinished.context)(status);
    _takeScreenshot(status);
  };
} else {
  takeScreenshot = _takeScreenshot;
}

// Kick off the page loading
if (options.siteType == 'url') {
  if (options.takeShotOnCallback) {
    page.onCallback = takeScreenshot;
    page.open(site);
  } else {
    page.open(site, takeScreenshot);
  }
} else {

  try {
    var f = fs.open(site, 'r');
    var pageContent = f.read();
    f.close();

    page[options.takeShotOnCallback
      ? 'onCallback'
      : 'onLoadFinished'] = takeScreenshot;

    page.setContent(pageContent, ''); // set content to be provided HTML
    page.reload();                    // issue reload to pull down any CSS or JS
  } catch (e) {
    console.error(e);
    phantom.exit(1);
  }
}


/*
 * Given a shotSize dimension, return the actual number of pixels in the
 * dimension that phantom should render.
 *
 * @param (Object) page
 * @param (String) dimension
 * @param (String or Number) value
 */
function pixelCount(page, dimension, value) {

  // Determine the page's dimensions
  var pageDimensions = page.evaluate(function(zoomFactor) {
    var body = document.body || {};
    var documentElement = document.documentElement || {};
    return {
      width: Math.max(
        body.offsetWidth
      , body.scrollWidth
      , documentElement.clientWidth
      , documentElement.scrollWidth
      , documentElement.offsetWidth
      ) * zoomFactor
    , height: Math.max(
        body.offsetHeight
      , body.scrollHeight
      , documentElement.clientHeight
      , documentElement.scrollHeight
      , documentElement.offsetHeight
      ) * zoomFactor
    };
  }, options.zoomFactor || 1);

  var x = {
    window: page.viewportSize[dimension]
  , all: pageDimensions[dimension]
  }[value] || value;

  return x;
}


/*
 * Bind the function `fn` to the context `context` in a serializable manner.
 * A tiny bit of a hack.
 *
 * @param (String) fn
 * @param (Object) context
 */
function buildEvaluationFn(fn, context) {
  return function() {
    var args = Array.prototype.slice.call(arguments);
    page.evaluate(function(fn, context, args) {
      eval('(' + fn + ')').apply(context, args);
    }, fn, context, args);
  };
}
