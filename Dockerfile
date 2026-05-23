FROM docker.io/vanjayak/open-design:latest

USER root
RUN apk add --no-cache nginx apache2-utils openssl

COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 7456

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/start.sh"]
