# Nachbau des Netcup-Webhostings: Apache 2.4 + PHP 8.1 (Mindestversion), .htaccess aktiv.
FROM php:8.1-apache
RUN a2enmod rewrite headers deflate mime \
 && sed -ri 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf \
 && printf 'display_errors=Off\nlog_errors=On\nexpose_php=Off\n' > /usr/local/etc/php/conf.d/rps.ini
