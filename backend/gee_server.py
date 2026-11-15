#!/usr/bin/env python3
"""
TerraVision — Google Earth Engine Microservice
=============================================
Runs a small Flask server on port 5001.
The Node.js backend calls this to fetch Sentinel-2 satellite images.

SETUP:
  pip install flask earthengine-api Pillow requests
  earthengine authenticate   (one-time browser auth)
  python gee_server.py

SERVICE ACCOUNT ALTERNATIVE (for server deployments):
  Set GEE_SERVICE_ACCOUNT and GEE_KEY_FILE env vars below.
"""

import os
import io
import base64
import json
from datetime import datetime, timedelta
from flask import Flask, request, jsonify

# ── Google Earth Engine ──────────────────────────────────────────────────────
import ee

# Auth: tries service account first, then falls back to user credentials
SERVICE_ACCOUNT = os.environ.get('GEE_SERVICE_ACCOUNT', '')
KEY_FILE        = os.environ.get('GEE_KEY_FILE', 'gee-key.json')

def init_gee():
    try:
        if SERVICE_ACCOUNT and os.path.exists(KEY_FILE):
            credentials = ee.ServiceAccountCredentials(SERVICE_ACCOUNT, KEY_FILE)
            ee.Initialize(credentials)
            print('[GEE] Initialized with service account')
        else:
            ee.Initialize(project='astral-altar-493517-r0')
            print('[GEE] Initialized with user credentials')
        return True
    except Exception as e:
        print(f'[GEE] Init failed: {e}')
        print('[GEE] Run: earthengine authenticate')
        return False

GEE_READY = init_gee()

# ── Flask App ─────────────────────────────────────────────────────────────────
app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'gee_ready': GEE_READY})


@app.route('/get-images', methods=['POST'])
def get_images():
    if not GEE_READY:
        return jsonify({'error': 'GEE not initialized. Run: earthengine authenticate'}), 503

    data     = request.get_json()
    bbox     = data.get('bbox', {})
    date_from = data.get('dateFrom')
    date_to   = data.get('dateTo')

    north = float(bbox.get('north'))
    south = float(bbox.get('south'))
    east  = float(bbox.get('east'))
    west  = float(bbox.get('west'))

    # Parse dates
    dt_from = datetime.strptime(date_from, '%Y-%m-%d')
    dt_to   = datetime.strptime(date_to,   '%Y-%m-%d')
    dt_mid  = dt_from + (dt_to - dt_from) / 2

    fmt = lambda d: d.strftime('%Y-%m-%d')

    geometry = ee.Geometry.BBox(west, south, east, north)

    def get_best_image(start_date, end_date):
        """Get the least cloudy Sentinel-2 image in a date range"""
        collection = (
            ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
            .sort('CLOUDY_PIXEL_PERCENTAGE')
        )

        count = collection.size().getInfo()
        if count == 0:
            # Relax cloud filter
            collection = (
                ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                .filterBounds(geometry)
                .filterDate(start_date, end_date)
                .sort('CLOUDY_PIXEL_PERCENTAGE')
            )
            count = collection.size().getInfo()

        if count == 0:
            return None, None

        image = collection.first()
        image_date = image.date().format('YYYY-MM-dd').getInfo()

        # True Color RGB (B4, B3, B2) with stretch
        rgb = image.select(['B4', 'B3', 'B2'])
        rgb_vis = rgb.visualize(min=0, max=3000, gamma=1.4)

        # Get thumbnail URL
        url = rgb_vis.getThumbURL({
            'region': geometry,
            'dimensions': 512,
            'format': 'jpg'
        })

        return url, image_date

    try:
        before_url, before_date = get_best_image(fmt(dt_from), fmt(dt_mid))
        after_url,  after_date  = get_best_image(fmt(dt_mid),  fmt(dt_to))

        if not before_url or not after_url:
            return jsonify({'error': 'No cloud-free images found for the selected area and dates'}), 404

        return jsonify({
            'before': {'url': before_url, 'date': before_date, 'source': 'Sentinel-2 SR'},
            'after':  {'url': after_url,  'date': after_date,  'source': 'Sentinel-2 SR'}
        })

    except Exception as e:
        print(f'[GEE] Error: {e}')
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print('\n🛰  TerraVision GEE Microservice starting on port 5001...')
    app.run(host='0.0.0.0', port=5001, debug=False)
