'use strict';

const streamToArray = require('stream-to-array');

const clog = (log) => {
  strapi.log.info(JSON.stringify(log));
};

const baseProvider = {
  extend(obj) {
    Object.assign(this, obj);
  },
  upload() {
    throw new Error('Provider upload method is not implemented');
  },
  delete() {
    throw new Error('Provider delete method is not implemented');
  },
};

// removed reliance on strapi v3 api
// const { convertToStrapiError } = require('../strapi-plugin-upload/errors')

const wrapFunctionForErrors =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      // throw convertToStrapiError(err)
      strapi.log.error(err);
      throw new Error(err);
    }
  };

const getProviderData = (file, options, providers) => {
  let providerKey;
  try {
    providerKey = options.selectProvider(file);
  } catch (err) {
    const msg = `The function selectProvider generated error`;
    strapi.log.error(msg);
    strapi.log.error(err);
    throw new Error(msg);
  }
  strapi.log.info(providerKey);
  clog(providers);
  let providerInstance = providers[providerKey];
  strapi.log.info(providerInstance.upload);

  if (!providerInstance) {
    const msg = `The upload provider with key '${providerKey}' not found`;
    strapi.log.error(msg);
    throw new Error(msg);
  }

  const providerFunctions = Object.assign(Object.create(baseProvider), {
    ...providerInstance,
    upload: wrapFunctionForErrors((file) => {
      return providerInstance.upload(file);
    }),
    uploadStream: wrapFunctionForErrors(async (file) => {
      if (providerInstance.uploadStream) {
        return providerInstance.uploadStream(file);
      } else {
        // fall back on converting file stream to buffer and using existing - will break on large files
        let buffer = await streamToArray(file.stream).then(function (parts) {
          const buffers = parts.map((part) =>
            Buffer.isBuffer(part) ? part : Buffer.from(part)
          );
          return Buffer.concat(buffers);
        });
        let fileWithBuffer = Object.assign(file, { buffer: buffer });

        return providerInstance.upload(fileWithBuffer);
      }
    }),
    delete: wrapFunctionForErrors((file) => {
      return providerInstance.delete(file);
    }),
  });

  return { providerFunctions, providerOptions: p.providerOptions };
};

const initProviders = (options) => {
  // check if select Provider function exists
  if (!options.selectProvider || typeof options.selectProvider !== 'function') {
    const msg = `config must define a selectProvider function`;
    strapi.log.error(msg);
    throw new Error(msg);
  }

  if (!options.providers) {
    const msg = `You must set providers object in providerOptions of config/plugins.js`;
    strapi.log.error(msg);
    throw new Error(msg);
  }

  const providerInstances = {};

  for (const [key, p] of Object.entries(options.providers)) {
    try {
      providerInstances[key] = require(`${p.provider}`).init(p.providerOptions);
    } catch (err) {
      const msg = `The provider package isn't installed. Please run \`npm install ${p.provider}\``;
      strapi.log.error(msg);
      throw new Error(msg);
    }
  }

  return providerInstances;
};

module.exports = {
  init(options) {
    const providers = initProviders(options);
    strapi.log.info(providers.cloudinary.upload);

    return {
      upload(file) {
        try {
          const { providerFunctions, providerOptions } = getProviderData(
            file,
            options,
            providers
          );
          return providerFunctions.upload(file);
        } catch (err) {
          return null;
        }
      },
      uploadStream(file) {
        try {
          const { providerFunctions, providerOptions } = getProviderData(
            file,
            options,
            providers
          );
          return providerFunctions.uploadStream(file);
        } catch (err) {
          return null;
        }
      },
      delete(file) {
        try {
          const { providerFunctions, providerOptions } = getProviderData(
            file,
            options,
            providers
          );
          return providerFunctions.delete(file);
        } catch (err) {
          return null;
        }
      },
    };
  },
};
