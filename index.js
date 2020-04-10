var es = require('event-stream');
var Vinyl = require('vinyl');
var PluginError = require('plugin-error');
var sharp = require('sharp');
var _ = require('lodash');
var path = require('path');

// consts
var PLUGIN_NAME = 'gulp-sharp';

var replaceExt = function (pathStr, ext) {
  return path.join(
    path.dirname(pathStr),
    path.basename(pathStr, path.extname(pathStr)) + ext);
};

var execute = function ( obj, task ) {

  var methodName = task[0];
  var passedValue = task[1];

  console.log(obj);

  if (!obj[ methodName ]) {
    console.error(`No sharp method '${methodName}' found`);
    return obj;
  }

  if (_.isArray(passedValue)) {
    return obj[ methodName ].apply(this, passedValue); // `this` will be binded later at runtime
  }

  return obj[ methodName ]( passedValue );
};

var getRotate = function( val ){
  if (_.isBoolean(val) && val === false) {
    return false;
  } else if (_.isBoolean(val) && val === true) {
    return ['rotate', undefined];
  } else {
    return ['rotate', val];
  }
};

var createSharpPipeline = function( opts ) {
  // create pipeline manually to preserve consistency
  var pipeline = [
    (opts.resize) ? ['resize', opts.resize] : undefined,
    (opts.withoutEnlargement) ? ['withoutEnlargement', undefined] : undefined,
    (opts.max) ? ['max', undefined] : undefined,
    (opts.crop) ? ['crop', sharp.gravity[opts.crop] ] : undefined,
    (opts.interpolateWith) ? ['interpolateWith', sharp.interpolator[opts.interpolateWith] ] : undefined,
    (opts.embedWhite) ? ['embedWhite', undefined] : undefined,
    (opts.embedBlack) ? ['embedBlack', undefined] : undefined,

    // rotate is special case, the value will be get with getRotate() function
    // because short-circuiting possible value 0 with undefined (which is get from EXIF) is impossible
    (getRotate(opts.rotate)) ? getRotate(opts.rotate) : undefined,
    (opts.extract) ? ['extract', [opts.extract.topOffset, opts.extract.leftOffset, opts.extract.width, opts.extract.height]] : undefined,
    (opts.sharpen) ? ['sharpen', undefined ] : undefined,
    (opts.gamma) ? ['gamma', opts.gamma ] : undefined,
    (opts.grayscale) ? ['grayscale', undefined] : undefined,
    (opts.withMetadata) ? ['withMetadata', undefined] : undefined,
    (opts.quality) ? ['quality', opts.quality] : undefined,
    (opts.progressive) ? ['progressive', undefined] : undefined,
    (opts.compressionLevel) ? ['compressionLevel', opts.compressionLevel] : undefined
  ];

  // remove task that is undefined
  pipeline = _.compact(pipeline);

  return async function( file ){

    var promises;
    var input = sharp(file.isNull() ? file.path : file.contents, {sequentialRead: true});
    var executeInstance = execute.bind(input);

    var metadata = await input.metadata();

    var transform = _.reduce( pipeline, function(accumulator, task){
      if (task[0] === 'scale') {
        const resizeTask = [
          'resize',
          [
            metadata.width * task[1][0],
            null,
            task[1][1]
          ]
        ];
        task = resizeTask;
      }

      return executeInstance(accumulator, task);
    }, input);

    if (opts.output) {
      transform = transform[opts.output]();
    }

    promises = transform.toBuffer();
    return promises;
  };
};

// plugin level function (dealing with files)
var gulpSharp = function( options ) {

  if ( options === undefined ) {
    throw new PluginError(PLUGIN_NAME, 'Missing options object');
  } else if ( ! _.isPlainObject(options) ) {
    throw new PluginError(PLUGIN_NAME, 'options object must be plain object (created with `{}` literal) ');
  } else if ( options.resize === undefined && options.extract === undefined && options.scale === undefined ) {
    throw new PluginError(PLUGIN_NAME, 'Please specify an extract, resize or scale property in your options object');
  } else if ( options.resize && Array.isArray( options.resize ) === false ) {
    throw new PluginError(PLUGIN_NAME, 'options.resize must be array');
  }

  // default options
  var DEFAULT = {
    crop : '', // Possible values are north, east, south, west, center.
    max : false, //false will be ignored
    embedWhite : false, //false will be ignored
    embedBlack : false, //false will be ignored
    rotate : false, //false will be ignored. true will use value from EXIF Orientation tag. Or a number 0, 90, 180 or 270
    withoutEnlargement : true,
    sharpen : false,
    interpolateWith : '', // [nearest, bilinear, bicubic, vertexSplitQuadraticBasisSpline, locallyBoundedBicubic, nohalo]
    gamma : false, // if present, is a Number betweem 1 and 3. The default value is 2.2, a suitable approximation for sRGB images.
    grayscale : false,
    output : '', // string of extension without dot ('.'). either ["jpeg", "png", "webp"]
    quality : false, // only applies JPEG, WebP and TIFF
    progressive : false,
    withMetadata : false,
    compressionLevel : false // only apply to png
  };

  var mergedOptions = _.merge(DEFAULT, options);
  var pipeline = createSharpPipeline(mergedOptions);

  // creating a stream through which each file will pass
  var stream = es.map(function(file, callback) {

    if (file.isStream()) {
      callback(new PluginError(PLUGIN_NAME, 'Streams are not supported.'));
    }

    pipeline(file).then(
      function(outputBuffer){ // onFulfilled
        var newFile = new Vinyl({
          'cwd' : file.cwd,
          'base' : file.base,
          'path' : file.path,
          'contents' : outputBuffer
        });

        if (mergedOptions.output) {
          // change file extension
          newFile.path = replaceExt(newFile.path, '.' + mergedOptions.output);
        }

        callback(null, newFile);
      },
      function(error){ // onRejected
        callback(error);
      }
    );
  });

  // returning the file stream
  return stream;
};

// exporting the plugin main function
module.exports = gulpSharp;
