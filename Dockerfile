FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY idguard-server.js .
COPY public/ ./public/
# Copy vendor files from node_modules into public/vendor/
# so all scripts are served from 'self' with no CDN dependency
RUN mkdir -p public/vendor && \
    cp node_modules/react/umd/react.production.min.js        public/vendor/react.js && \
    cp node_modules/react-dom/umd/react-dom.production.min.js public/vendor/react-dom.js && \
    cp node_modules/htm/dist/htm.umd.js                       public/vendor/htm.js
EXPOSE 3000
CMD ["node", "idguard-server.js"]
