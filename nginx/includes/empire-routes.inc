# Shared route table for the production server blocks.

add_header X-Frame-Options        "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff"    always;
add_header Referrer-Policy        "strict-origin-when-cross-origin" always;
add_header X-XSS-Protection       "0" always;
add_header Permissions-Policy     "geolocation=(), microphone=(), camera=(), payment=(self)" always;
add_header Cross-Origin-Opener-Policy   "same-origin" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://checkout.razorpay.com https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' ws: wss: https://api.razorpay.com https://api.stripe.com; frame-src https://api.razorpay.com https://js.stripe.com; object-src 'none'; base-uri 'self'; form-action 'self'" always;

limit_conn conn_zone 60;

location = /nginx-health {
    access_log off;
    default_type text/plain;
    return 200 "ok\n";
}

# Liveness is safe to expose - it reports no internal state.
location = /health {
    proxy_pass http://empire_backend/api/health;
    access_log off;
}

# Readiness reports dependency latency and error strings, so it stays internal
# in production. The container healthcheck reaches it directly on :4000.
location = /ready      { deny all; }
location = /api/ready  { deny all; }

location ~ ^/api/v[0-9]+/auth/(login|register|password/forgot|password/reset|verify/resend) {
    limit_req zone=auth_zone burst=5 nodelay;
    limit_req_status 429;
    proxy_pass http://empire_backend;
    proxy_read_timeout 30s;
}

# Payment webhooks: no rate limit (the provider retries), raw body preserved.
location ~ ^/api/v[0-9]+/payments/webhook {
    proxy_pass http://empire_backend;
    proxy_request_buffering on;
    proxy_read_timeout 30s;
}

location /api/ {
    limit_req zone=api_zone burst=60 nodelay;
    limit_req_status 429;
    proxy_pass http://empire_backend;
    proxy_read_timeout 60s;
    proxy_buffering off;
}

location /socket.io/ {
    proxy_pass http://empire_backend;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 7d;
    proxy_send_timeout 7d;
    proxy_buffering off;
    access_log off;
}

location /admin {
    limit_req zone=admin_zone burst=40 nodelay;
    proxy_pass http://empire_admin;
    proxy_read_timeout 60s;
}

# Immutable hashed bundles.
location ~* ^/(assets|static)/.*\.(js|css|woff2?|png|jpe?g|webp|avif|svg|glb|gltf|bin|ktx2|basis|mp3|ogg|wasm)$ {
    root /srv;
    try_files /assets$uri @spa;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
    access_log off;
}

location @spa { proxy_pass http://empire_frontend; }

location / {
    proxy_pass http://empire_frontend;
    proxy_read_timeout 30s;
}
