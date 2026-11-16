# Collabify's Word → PDF converter: Gotenberg (LibreOffice) for Cloud Run, plus
# Microsoft's core fonts (Times New Roman, Arial, Courier New, Georgia, Verdana…)
# so a thesis typed in Times New Roman comes out in Times New Roman, not a look-alike.
# Calibri and Cambria are Office fonts nobody may redistribute; Gotenberg's Carlito
# and Caladea have the same widths, so lines and page breaks still fall where Word puts them.
#
# Deploy: see docs/word-pdf-previews.md.

FROM gotenberg/gotenberg:9-libreoffice-cloudrun

USER root

RUN . /etc/os-release \
 && echo "deb http://deb.debian.org/debian ${VERSION_CODENAME} contrib" > /etc/apt/sources.list.d/contrib.list \
 && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends ttf-mscorefonts-installer \
 && fc-cache -f \
 && fc-list | grep -qi "Times New Roman" \
 && rm -rf /var/lib/apt/lists/*

USER gotenberg
