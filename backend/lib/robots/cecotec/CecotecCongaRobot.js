const capabilities = require("./capabilities");
const fs = require("fs");
const Logger = require("../../Logger");
const PendingMapChangeValetudoEvent = require("../../valetudo_events/events/PendingMapChangeValetudoEvent");
const SelectionPreset = require("../../entities/core/ValetudoSelectionPreset");
const ValetudoRobot = require("../../core/ValetudoRobot");
const {
    BatteryStateAttribute,
    StatusStateAttribute,
    OperationModeStateAttribute,
    PresetSelectionStateAttribute,
    AttachmentStateAttribute,
} = require("../../entities/state/attributes");
const {
    CloudServer,
    DeviceFanSpeed,
    DeviceWaterLevel,
    DeviceState,
} = require("@agnoc/core");
const {
    ValetudoMap,
    PointMapEntity,
    PathMapEntity,
    MapLayer,
    PolygonMapEntity,
    LineMapEntity,
} = require("../../entities/map");
const { DeviceMode } = require("@agnoc/core");

const DEVICE_MODE_TO_STATUS_STATE_FLAG = {
    [DeviceMode.VALUE.NONE]: StatusStateAttribute.FLAG.NONE,
    [DeviceMode.VALUE.SPOT]: StatusStateAttribute.FLAG.SPOT,
    [DeviceMode.VALUE.ZONE]: StatusStateAttribute.FLAG.ZONE,
};

function throttle(callback, wait = 1000, immediate = true) {
    let timeout = null;
    let initialCall = true;

    return function () {
        const callNow = immediate && initialCall;
        const next = () => {
            callback.apply(this, arguments);
            timeout = null;
        };

        if (callNow) {
            initialCall = false;
            next();
        }

        if (!timeout) {
            timeout = setTimeout(next, wait);
        }
    };
}

module.exports = class CecotecCongaRobot extends ValetudoRobot {
    constructor(options) {
        super(options);

        this.pathPoints = [];
        this.server = new CloudServer();
        this.emitStateUpdated = throttle(this.emitStateUpdated.bind(this));
        this.emitStateAttributesUpdated = throttle(
            this.emitStateAttributesUpdated.bind(this)
        );
        this.emitMapUpdated = throttle(this.emitMapUpdated.bind(this));

        this.registerCapability(
            new capabilities.CecotecBasicControlCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecCarpetModeControlCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecCombinedVirtualRestrictionsCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecConsumableMonitoringCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecCurrentStatisticsCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecDoNotDisturbCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecFanSpeedControlCapability({
                robot: this,
                presets: Object.values(DeviceFanSpeed.VALUE)
                    .filter((k) => {
                        return typeof k === "string";
                    })
                    .map((k) => {
                        return new SelectionPreset({ name: String(k), value: k });
                    }),
            })
        );
        this.registerCapability(
            new capabilities.CecotecGoToLocationCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecLocateCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecManualControlCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecMapResetCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecMapSegmentationCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecMapSegmentEditCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecMapSegmentRenameCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecPendingMapChangeHandlingCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecPersistentMapControlCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecSpeakerTestCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecSpeakerVolumeControlCapability({
                robot: this,
            })
        );
        this.registerCapability(
            new capabilities.CecotecWaterUsageControlCapability({
                robot: this,
                presets: Object.values(DeviceWaterLevel.VALUE).map((k) => {
                    return new SelectionPreset({ name: String(k), value: k });
                }),
            })
        );
        if (this.config.get("embedded") === true) {
            this.registerCapability(
                new capabilities.CecotecWifiConfigurationCapability({
                    robot: this,
                    networkInterface: "wlan0",
                })
            );
        }
        this.registerCapability(
            new capabilities.CecotecZoneCleaningCapability({
                robot: this,
            })
        );

        this.server.on("error", this.onError.bind(this));
        this.server.on("addRobot", this.onAddRobot.bind(this));

        void this.server.listen("0.0.0.0");
    }

    /**
     * @returns {string}
     */
    getManufacturer() {
        return "Cecotec";
    }

    /**
     * @returns {string}
     */
    getModelName() {
        return "Conga";
    }

    async shutdown() {
        await this.server.close();
    }

    /**
     * @type {import("@agnoc/core").Robot|undefined}
     */
    get robot() {
        return this.server.getRobots().find((robot) => {
            return robot.isConnected;
        });
    }

    onError(err) {
        Logger.error(err);
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     */
    onAddRobot(robot) {
        Logger.info(`Added new robot with id '${robot.device.id}'`);

        robot.on("updateDevice", () => {
            return this.onUpdateDevice(robot);
        });
        robot.on("updateMap", () => {
            return this.onUpdateMap(robot);
        });
        robot.on("updateRobotPosition", () => {
            return this.onUpdateRobotPosition(robot);
        });
        robot.on("updateChargerPosition", () => {
            return this.onUpdateChargerPosition(robot);
        });
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     */
    onUpdateDevice(robot) {
        const oldStatus =
      this.state.getFirstMatchingAttributeByConstructor(StatusStateAttribute);
        const newStatus = this.getStatusState(robot);

        // Reset path points when robot goes from docked to another state.
        if (
            oldStatus &&
      oldStatus.value !== newStatus.value &&
      oldStatus.value === StatusStateAttribute.VALUE.DOCKED
        ) {
            this.pathPoints = [];
        }

        this.state.upsertFirstMatchingAttribute(this.getBatteryState(robot));
        this.state.upsertFirstMatchingAttribute(this.getStatusState(robot));
        this.state.upsertFirstMatchingAttribute(this.getIntensityState(robot));
        this.state.upsertFirstMatchingAttribute(this.getWaterUsageState(robot));

        this.state.upsertFirstMatchingAttribute(
            new AttachmentStateAttribute({
                type: AttachmentStateAttribute.TYPE.DUSTBIN,
                attached: !robot.device.hasMopAttached,
            })
        );
        this.state.upsertFirstMatchingAttribute(
            new AttachmentStateAttribute({
                type: AttachmentStateAttribute.TYPE.WATERTANK,
                attached: robot.device.hasMopAttached,
            })
        );
        this.state.upsertFirstMatchingAttribute(
            new AttachmentStateAttribute({
                type: AttachmentStateAttribute.TYPE.MOP,
                attached: robot.device.hasMopAttached,
            })
        );
        this.state.upsertFirstMatchingAttribute(
            new OperationModeStateAttribute({
                value: robot.device.hasMopAttached ?
                    OperationModeStateAttribute.VALUE.VACUUM_AND_MOP :
                    OperationModeStateAttribute.VALUE.VACUUM,
            })
        );

        this.emitStateAttributesUpdated();

        if (robot.device.hasWaitingMap) {
            const event = new PendingMapChangeValetudoEvent({});

            if (!this.valetudoEventStore.getById(event.id)) {
                this.valetudoEventStore.raise(event);
            }
        }
    }

    /**
     * @param {import("@agnoc/core").DeviceMap} map
     */
    getRobotEntity(map) {
        if (!map.robot) {
            return;
        }

        const offset = map.size.y;
        const { x, y } = map.toPixel(map.robot.toCoordinates());

        return new PointMapEntity({
            type: PointMapEntity.TYPE.ROBOT_POSITION,
            points: [x, offset - y],
            metaData: {
                angle: map.robot.degrees,
            },
        });
    }

    /**
     * @param {import("@agnoc/core").DeviceMap} map
     */
    getChargerEntity(map) {
        if (!map.charger) {
            return;
        }

        const offset = map.size.y;
        const { x, y } = map.toPixel(map.charger.toCoordinates());

        return new PointMapEntity({
            type: PointMapEntity.TYPE.CHARGER_LOCATION,
            points: [x, offset - y],
            metaData: {
                angle: map.charger.degrees,
            },
        });
    }

    /**
     * @param {import("@agnoc/core").DeviceMap} map
     */
    getGoToTarget(map) {
        if (!map.currentSpot) {
            return;
        }

        const offset = map.size.y;
        const { x, y } = map.toPixel(map.currentSpot.toCoordinates());

        return new PointMapEntity({
            type: PointMapEntity.TYPE.GO_TO_TARGET,
            points: [x, offset - y],
            metaData: {
                angle: map.currentSpot.degrees,
            },
        });
    }

    /**
     * @param {import("@agnoc/core").DeviceMap} map
     */
    updatePathPoints(map) {
        if (!map.robot || map.robotPath.length > 0) {
            return;
        }

        const offset = map.size.y;
        const { x, y } = map.toPixel(map.robot.toCoordinates());

        this.pathPoints.push(x, offset - y);
    }

    /**
     * @param {import("@agnoc/core").DeviceMap} map
     */
    getPathEntity(map) {
        const offset = map.size.y;
        const robotPath =
      map.robotPath &&
      map.robotPath
          .map((coordinate) => {
              const { x, y } = map.toPixel(coordinate);

              return [x, offset - y];
          })
          .flat();

        const points =
      robotPath && robotPath.length > 0 ? robotPath : this.pathPoints;

        if (points.length === 0) {
            return;
        }

        return new PathMapEntity({
            type: PathMapEntity.TYPE.PATH,
            points: points,
        });
    }

    /**
     * @param {import("@agnoc/core").DeviceMap} map
     */
    getMapEntities(map) {
        const { size, grid } = map;
        const offset = 5;
        const walls = [];
        const floor = [];

        // apply offset to remove fake bottom line.
        for (let x = offset; x < size.x - offset; x++) {
            for (let y = offset; y < size.y - offset; y++) {
                const coord = (size.y - y) * size.y + x;
                const point = grid[coord];

                if (point === 255) {
                    walls.push(x, y);
                } else if (point !== 0) {
                    floor.push(x, y);
                }
            }
        }

        return {
            floor: floor.length ?
                new MapLayer({
                    type: MapLayer.TYPE.FLOOR,
                    pixels: floor,
                }) :
                null,
            walls: walls.length ?
                new MapLayer({
                    type: MapLayer.TYPE.WALL,
                    pixels: walls,
                }) :
                null,
        };
    }

    // Convert walls and floor array to matrix style
    /**
     * @param {import("../../../lib/entities/map/MapLayer")} walls
     * @param {import("../../../lib/entities/map/MapLayer")} floor
     */
    mapArrayToMatrix(walls, floor) {
        // check if dimensions is null (empty map?)
        if (walls === null || floor === null) {
            return [];
        }


        // Create a map filled with [(0,0),(0,0), ...]
        let map = new Array();
        // first, find what is bigger, if walls or floor
        let maxX = 0;
        let maxY = 0;
        if (walls.dimensions.x.max > floor.dimensions.x.max) {
            maxX = walls.dimensions.x.max;
        } else {
            maxX = floor.dimensions.x.max;
        }
        if (walls.dimensions.y.max > floor.dimensions.y.max) {
            maxY = walls.dimensions.y.max;
        } else {
            maxY = floor.dimensions.y.max;
        }
        for (let i = 0; i <= maxX; i++) {
            map[i] = new Array();
            for (let j = 0; j <= maxY; j++) {
                map[i][j] = 0;
            }
        }
        // id 1 = walls
        // id 255 = floor
        for ( let i = 0; i < floor.congaPixels.length; i = i + 2) {
            let x = floor.congaPixels[i];
            let y = floor.congaPixels[i + 1];
            map[x][y] = 255;
        }
        for ( let i = 0; i < walls.congaPixels.length; i = i + 2) {
            let x = walls.congaPixels[i];
            let y = walls.congaPixels[i + 1];
            map[x][y] = 1;
        }

        return map;
    }

    // fill recursive
    /**
     * @param {number} x
     * @param {number} y
     * @param {string | any[]} fullMap
     * @param {import("../../../lib/entities/map/MapLayer")} layer
     */
    boundaryFill8( x, y, fullMap, layer) {
        let maxX = fullMap.length;
        let maxY = fullMap[0].length;
        let pixels = [];
        fullMap[x][y] = layer.metaData.segmentId;
        pixels.push(x, y);
        while (pixels.length !== 0) {
            x = pixels.shift();
            y = pixels.shift();

            if (x + 1 <= maxX && fullMap[x+1][y] === 255) {
                pixels.push(x + 1, y);
                fullMap[x+1][y] = layer.metaData.segmentId;
                layer.congaPixels.push(x+1, y);
            }
            if (y + 1 <= maxY && fullMap[x][y+1] === 255) {
                pixels.push(x, y + 1);
                fullMap[x][y+1] = layer.metaData.segmentId;
                layer.congaPixels.push(x, y+1);
            }
            if (x - 1 >= 0 && fullMap[x-1][y] === 255) {
                pixels.push(x - 1, y);
                fullMap[x-1][y] = layer.metaData.segmentId;
                layer.congaPixels.push(x-1, y);
            }
            if (y - 1 >= 0 && fullMap[x][y-1] === 255) {
                pixels.push(x, y - 1);
                fullMap[x][y-1] = layer.metaData.segmentId;
                layer.congaPixels.push(x, y-1);
            }
        }
    }

    /**
     * @param {import("@agnoc/core").DeviceMap} map
     * @param {import("@agnoc/core").Room} room
     */
    getSegmentEntity(map, room) {
        const offset = map.size.y; // 800 in Conga 3490
        const pixels = room.pixels.map(({ x, y }) => {
            return [x, offset - y];
        });

        return pixels.length ?
            new MapLayer({
                type: MapLayer.TYPE.SEGMENT,
                pixels: pixels.flat(),
                metaData: {
                    segmentId: room.id.value.toString(),
                    active: room.isEnabled,
                    name: room.name,
                },
            }) :
            null;
    }

    /**
     * @param {any[]} fullMap fullMap
     * @param {import("../../../lib/entities/map/MapLayer")} layer
     */
    dumpSegmentLayer(fullMap, layer) {
        // layer.metaData.segmentId
        for (let i = 0; i < layer.congaPixels.length; i = i + 2) {
            let x = layer.congaPixels[i];
            let y = layer.congaPixels[i + 1];
            if (fullMap[x][y] === 255) {
                fullMap[x][y] = layer.metaData.segmentId;
            }
        }
    }

    // Adapted from https://stackoverflow.com/a/53660837
    /**
     * @param {any[]} numbers
     */
    median (numbers) { //Note that this will modify the input array
        numbers.sort((a, b) => {
            return a - b;
        });

        const middle = Math.floor(numbers.length / 2);

        if (numbers.length % 2 === 0) {
            return (numbers[middle - 1] + numbers[middle]) / 2;
        }

        return numbers[middle];
    }

    // clean segments
    /*clearSegment(s, fullMap) {
        for (let i = 0; i < s.congaPixels.length; i = i + 2) {
            x.push(s.congaPixels[i]);
            y.push(s.congaPixels[i + 1]);
        }
    }*/

    /**
     * @param {import("@agnoc/core").DeviceMap} map
     * @param {any[]} fullMap
     */
    getSegmentEntities(map, fullMap) {
        const { rooms } = map;

        let r = (
            rooms.map((room) => {
                return this.getSegmentEntity(map, room);
            }) || []
        );

        if (fullMap.length !== 0) {
            // try to fill the segment, fu** Cec****
            // first, dump the segment layers to the map
            r.forEach(s => {
                this.dumpSegmentLayer(fullMap, s);
            });
            r.forEach(s => {
                let x = [];
                let y = [];

                for (let i = 0; i < s.congaPixels.length; i = i + 2) {
                    x.push(s.congaPixels[i]);
                    y.push(s.congaPixels[i + 1]);
                }

                let middleX = Math.round(this.median(x));
                let middleY = Math.round(this.median(y));

                this.boundaryFill8(middleX, middleY, fullMap, s);
            });
        }

        // compress congaPixels 
        r.forEach(s => {
            s.compressPixels(s.congaPixels);
        });

        return r;
    }

    /**
     * @param {import("@agnoc/core").DeviceMap} map
     */
    getRestrictedZoneEntities(map) {
        const offset = map.size.y;
        const { restrictedZones } = map;

        return restrictedZones
            .map((zone) => {
                const points = zone.coordinates
                    .map((coordinate) => {
                        try {
                            const { x, y } = map.toPixel(coordinate);

                            return [x, offset - y];
                        } catch (e) {
                            return null;
                        }
                    })
                    .filter(Boolean);

                if (points.length < 4) {
                    return null;
                }

                if (
                    points[0].join() === points[2].join() &&
                    points[1].join() === points[3].join()
                ) {
                    return new LineMapEntity({
                        type: LineMapEntity.TYPE.VIRTUAL_WALL,
                        points: [points[0], points[1]].flat(),
                    });
                }

                return new PolygonMapEntity({
                    type: PolygonMapEntity.TYPE.NO_GO_AREA,
                    points: [points[0], points[3], points[2], points[1]].flat(),
                });
            })
            .filter(Boolean);
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     */
    onUpdateMap(robot) {
        const { map } = robot.device;

        if (!map) {
            return;
        }

        const { floor, walls} = this.getMapEntities(map);

        this.updatePathPoints(map);

        this.state.map = new ValetudoMap({
            pixelSize: 1, // ?
            entities: [
                this.getChargerEntity(map),
                this.getRobotEntity(map),
                this.getGoToTarget(map),
                this.getPathEntity(map),
                ...this.getRestrictedZoneEntities(map),
            ].filter(Boolean),
            layers: [floor, walls, ...this.getSegmentEntities(map, this.mapArrayToMatrix(walls, floor))].filter(Boolean),
            metaData: {},
            size: {
                x: map.size.x,
                y: map.size.y,
            },
        });

        this.emitMapUpdated();
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     */
    onUpdateChargerPosition(robot) {
        const { map } = robot.device;

        if (!map || !this.state.map) {
            return;
        }

        const entity = this.getChargerEntity(map);

        this.state.map.entities = [
            ...this.state.map.entities.filter((entity) => {
                return entity.type !== PointMapEntity.TYPE.CHARGER_LOCATION;
            }),
            entity,
        ];

        this.emitMapUpdated();
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     */
    onUpdateRobotPosition(robot) {
        const { map } = robot.device;

        if (!map || !this.state.map) {
            return;
        }

        this.updatePathPoints(map);

        this.state.map.entities = [
            ...this.state.map.entities.filter((entity) => {
                return entity.type !== PointMapEntity.TYPE.ROBOT_POSITION;
            }),
            this.getRobotEntity(map),
        ];

        this.emitMapUpdated();
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     */
    getBatteryState(robot) {
        const { state, battery } = robot.device;
        let flag = BatteryStateAttribute.FLAG.DISCHARGING;

        if (battery && state && state.value === DeviceState.VALUE.DOCKED) {
            flag =
        battery.value === 100 ?
            BatteryStateAttribute.FLAG.CHARGED :
            BatteryStateAttribute.FLAG.CHARGING;
        }

        return new BatteryStateAttribute({
            level: battery ? battery.value : 0,
            flag: flag,
        });
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     */
    getStatusState(robot) {
        const { state, mode, error } = robot.device;
        const flag =
      DEVICE_MODE_TO_STATUS_STATE_FLAG[mode?.value] ||
      StatusStateAttribute.FLAG.NONE;

        return new StatusStateAttribute({
            value: state ? state.value : StatusStateAttribute.VALUE.DOCKED,
            flag: flag,
            metaData: {
                error_description: error && error.value,
            },
        });
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     */
    getIntensityState(robot) {
        const { fanSpeed } = robot.device;

        return new PresetSelectionStateAttribute({
            type: PresetSelectionStateAttribute.TYPE.FAN_SPEED,
            // TODO: this should have a mapper.
            value: fanSpeed ?
                fanSpeed.value :
                PresetSelectionStateAttribute.INTENSITY.OFF,
        });
    }

    /**
     * @param {import("@agnoc/core").Robot} robot
     */
    getWaterUsageState(robot) {
        const { waterLevel } = robot.device;

        return new PresetSelectionStateAttribute({
            type: PresetSelectionStateAttribute.TYPE.WATER_GRADE,
            // TODO: this should have a mapper.
            value: waterLevel ?
                waterLevel.value :
                PresetSelectionStateAttribute.INTENSITY.OFF,
        });
    }

    static IMPLEMENTATION_AUTO_DETECTION_HANDLER() {
        const path = "/mnt/UDISK/config/device_config.ini";
        let deviceConf;

        Logger.trace("Trying to open device.conf at " + path);

        try {
            deviceConf = fs.readFileSync(path);
        } catch (e) {
            Logger.trace("cannot read", path, e);

            return false;
        }

        let result = {};

        if (deviceConf) {
            deviceConf
                .toString()
                .split(/\n/)
                .map((line) => {
                    return line.split(/=/, 2);
                })
                .map(([k, v]) => {
                    return (result[k] = v);
                });
        }

        Logger.trace("Software version: " + result.software_version);

        return Boolean(result.software_version);
    }
};
