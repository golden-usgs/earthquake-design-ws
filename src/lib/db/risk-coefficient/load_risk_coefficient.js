'use strict';

const Config = require('../../util/config'),
    copyFrom = require('pg-copy-streams').from,
    dbUtils = require('../db-utils'),
    UrlStream = require('../../util/url-stream'),
    zlib = require('zlib');

// variables/data
let config = Config().get(),
    db,
    documents = require('./documents.json'),
    regions = require('./regions.json');


const RiskCoefficientDataLoader = function(_db) {
  let _this;

  _this = {};

  _this.db = _db;

  /**
   * Create database schema.
   *
   * Based on config.DB_SCHEMA_RISK_COEFFICIENT.
   *
   * @return {Promise}
   *    promise representing schema has been created.
   */
  _this.createSchema = (() => {
    var schemaName,
        schemaUser;

    schemaName = config.DB_SCHEMA_RISK_COEFFICIENT;
    schemaUser = config.DB_USER;

    if(!schemaName || !schemaUser) {
      throw new Error('Risk Coefficient schema name not configured');
    }

    return dbUtils.createSchema({
      db: _this.db,
      file: __dirname + '/./schema.sql',
      name: config.DB_SCHEMA_RISK_COEFFICIENT,
      user: config.DB_USER
    });
  });

  /**
   * Insert region metadata.
   *
   * @return {Promise<Array<String, Int>>}
   *    resolves to mapping from region name to region id.
   */
  _this.insertRegions = _this.createSchema().then(() => {
    var promise,
        regionIds;

    // load regions
    promise = Promise.resolve();
    regionIds = {};
    regions.forEach((region) => {
      promise = promise.then(() => {
        return _this.db.query(`
          INSERT INTO region (
            name,
            grid_spacing,
            max_latitude,
            max_longitude,
            min_latitude,
            min_longitude
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [
          region.name,
          region.grid_spacing,
          region.max_latitude,
          region.max_longitude,
          region.min_latitude,
          region.min_longitude
        ]).then((result) => {
          // save region id for later data loading
          regionIds[region.name] = result.rows[0].id;
        });
      });
    });

    return promise.then(() => {
      // all regions inserted, and IDs should be set
      return regionIds;
    });
  });

  /**
   * Insert document metadata.
   *
   * @return {Promise}
   *     promise representing document metadata being inserted.
   */
  _this.insertDocuments = _this.insertRegions.then((regionIds) => {
    var promise;

    promise = Promise.resolve();
    documents.forEach((doc) => {
      doc.regions.forEach((region) => {
        var regionId;

        if (!regionIds.hasOwnProperty(region)) {
          throw new Error('Region "' + region + '" not found' +
              ', inserting document ' + doc.name);
        }
        regionId = regionIds[region];

        promise = promise.then(() => {
          return _this.db.query(`
            INSERT INTO document (
              region_id,
              name
            ) VALUES ($1, $2)
          `, [
            regionId,
            doc.name
          ]);
        });
      });
    });

    return promise;
  });


  /**
   * Insert region data.
   *
   * @return {Promise}
   *     promise representing that all region data has been inserted.
   */
  _this.insertData = _this.insertRegions.then((regionIds) => {
    var promise;

    promise = Promise.resolve();

    regions.forEach((region) => {
      // run each region load in sequence
      promise = promise.then(() => {

        process.stderr.write('Loading ' + region.name + ' region data\n');

        return _this.db.query('DROP TABLE IF EXISTS temp_region_data CASCADE').then(() => {
          // create temporary table for loading data
          return _this.db.query(`
            CREATE TABLE temp_region_data (
              latitude NUMERIC NOT NULL,
              longitude NUMERIC NOT NULL,
              cr1 NUMERIC DEFAULT NULL,
              crs NUMERIC DEFAULT NULL
            )
          `);
        }).then(() => {
          // use copy from to read data
          return new Promise((resolve, reject) => {
            var data,
                doReject,
                doResolve,
                stream;

            data = UrlStream({
              url: region.url
            });

            stream = _this.db.query(copyFrom(`
                COPY temp_region_data
                (latitude, longitude, cr1, crs)
                FROM STDIN
                WITH CSV HEADER
            `));

            doReject = (err) => {
              data.destroy();
              reject(err);
            };

            doResolve = () => {
              data.destroy();
              resolve();
            };

            data.on('error', doReject);
            stream.on('error', doReject);
            stream.on('end', doResolve);
            data.pipe(zlib.createGunzip()).pipe(stream);
          });
        }).then(() => {
          // transfer data into actual table
          return _this.db.query(`
            INSERT INTO data (
              region_id,
              latitude,
              longitude,
              cr1,
              crs
            ) (
              SELECT
                $1,
                latitude,
                longitude,
                cr1,
                crs
                FROM temp_region_data
            )
          `, [regionIds[region.name]]);
        }).then(() => {
          // remove temporary table
          return _this.db.query('DROP TABLE temp_region_data CASCADE');
        });
      });
    });

    return promise;
  });

  _this.createIndexes = Promise.all([_this.insertData, _this.insertDocuments]).then(() => {
    return dbUtils.readSqlFile(__dirname + '/./index.sql').then((statements) => {
      return dbUtils.exec(_this.db, statements);
    });
  });

  _this.closeDBConnection = (() => {
    return new Promise((resolve, reject) => {
      _this.db.end((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(null);
        }
      });
    });
  });

  return _this;
};

module.exports = RiskCoefficientDataLoader;
