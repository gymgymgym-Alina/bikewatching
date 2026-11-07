import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

mapboxgl.accessToken =
  "pk.eyJ1IjoiYWxnMTA2IiwiYSI6ImNtdzZ4eW03ZDBucGMzMHB3dWZ2OTRsc2EifQ.q7DeuAEwCCvBp26D8oUMZQ";

const BOSTON_ROUTES =
  "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson";
const CAMBRIDGE_ROUTES =
  "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson";
const STATIONS = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
const TRIPS = "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const bikeLaneStyle = {
  "line-color": "#32d400",
  "line-width": 3,
  "line-opacity": 0.4,
};

const svg = d3.select("#map").select("svg");
const timeSlider = document.getElementById("time-slider");
const selectedTime = document.getElementById("selected-time");
const anyTimeLabel = document.getElementById("any-time");

const radiusScale = d3.scaleSqrt().range([0, 25]);
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

let stations = [];
let circles = svg.selectAll("circle");
const departuresByMinute = Array.from({ length: 1440 }, () => []);
const arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function getCoords(station) {
  const point = map.project(new mapboxgl.LngLat(+station.lon, +station.lat));
  return { cx: point.x, cy: point.y };
}

function formatTime(minutes) {
  return new Date(0, 0, 0, 0, minutes).toLocaleString("en-US", { timeStyle: "short" });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();

  const min = (minute - 60 + 1440) % 1440;
  const max = (minute + 60) % 1440;

  if (min > max) {
    return tripsByMinute.slice(min).concat(tripsByMinute.slice(0, max)).flat();
  }
  return tripsByMinute.slice(min, max).flat();
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name;
    const arrived = arrivals.get(id) ?? 0;
    const departed = departures.get(id) ?? 0;

    return {
      ...station,
      arrivals: arrived,
      departures: departed,
      totalTraffic: arrived + departed,
    };
  });
}

function updatePositions() {
  circles.attr("cx", (d) => getCoords(d).cx).attr("cy", (d) => getCoords(d).cy);
}

function updateScatterPlot(timeFilter) {
  const filtered = computeStationTraffic(stations, timeFilter);

  radiusScale.range(timeFilter === -1 ? [0, 25] : [3, 50]);

  circles = svg
    .selectAll("circle")
    .data(filtered, (d) => d.short_name)
    .join((enter) => enter.append("circle").call((sel) => sel.append("title")))
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .style("--departure-ratio", (d) =>
      stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5)
    );

  circles
    .select("title")
    .text(
      (d) =>
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
    );

  updatePositions();
}

function updateTimeDisplay() {
  const timeFilter = Number(timeSlider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = "";
    anyTimeLabel.style.display = "block";
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = "none";
  }

  if (stations.length) updateScatterPlot(timeFilter);
}

map.on("load", async () => {
  map.addSource("boston_route", { type: "geojson", data: BOSTON_ROUTES });
  map.addLayer({
    id: "bike-lanes",
    type: "line",
    source: "boston_route",
    paint: bikeLaneStyle,
  });

  map.addSource("cambridge_route", { type: "geojson", data: CAMBRIDGE_ROUTES });
  map.addLayer({
    id: "cambridge-bike-lanes",
    type: "line",
    source: "cambridge_route",
    paint: bikeLaneStyle,
  });

  try {
    const stationData = await d3.json(STATIONS);
    stations = stationData.data.stations;

    await d3.csv(TRIPS, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
      arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);
      return trip;
    });

    radiusScale.domain([0, d3.max(computeStationTraffic(stations), (d) => d.totalTraffic)]);

    updateScatterPlot(Number(timeSlider.value));
  } catch (error) {
    console.error("Error loading station or trip data:", error);
  }
});

map.on("move", updatePositions);
map.on("zoom", updatePositions);
map.on("resize", updatePositions);
map.on("moveend", updatePositions);

timeSlider.addEventListener("input", updateTimeDisplay);
updateTimeDisplay();
