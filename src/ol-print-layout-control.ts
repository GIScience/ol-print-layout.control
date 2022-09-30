import Control from 'ol/control/Control';
import {transformExtent} from 'ol/proj';
import {getDistance} from 'ol/sphere';
import {Map, MapEvent} from 'ol';
import {Size} from 'ol/size';
import './ol-print-layout-control.css'

// paper
export const ORIENTATION = {
    PORTRAIT: 'portrait',
    LANDSCAPE: 'landscape'
} as const;

export const PAPER_FORMAT = {
    A4: 'A4',
    A3: 'A3',
    A2: 'A2',
    A1: 'A1',
    A0: 'A0',
    LETTER: 'LETTER',
    TABLOID: 'TABLOID',
    BROADSHEET: 'BROADSHEET'
} as const;

const INCH2MM = 25.4;

/**
 * Paper dimensions in mm
 * @type {{A1: {short: number, long: number}, A2: {short: number, long: number}, A3: {short: number, long: number}, LETTER: {short: number, long: number}, A4: {short: number, long: number}, BROADSHEET: {short: number, long: number}, A0: {short: number, long: number}, TABLOID: {short: number, long: number}}}
 */
const PAPER_SIZE: { [format: string]: { short: number, long: number } } = {
    A4: {short: 210, long: 297},
    A3: {short: 297, long: 420},
    A2: {short: 420, long: 594},
    A1: {short: 594, long: 841},
    A0: {short: 841, long: 1189},
    LETTER: {short: 8.5 * INCH2MM, long: 11 * INCH2MM},
    TABLOID: {short: 11 * INCH2MM, long: 17 * INCH2MM},
    BROADSHEET: {short: 17 * INCH2MM, long: 22 * INCH2MM}

} as const;

const PrintLayoutProperty = {
    BBOX: 'bbox',
    FORMAT: 'format',
    ORIENTATION: 'orientation',
    //in cm
    MARGINS: 'margins'
}

export type Options = {
    margins?: { top: number; left: number; bottom: number; right: number };
    format?: string;
    orientation?: string;
}

export class PrintLayout extends Control {
    private printArea: HTMLDivElement;

    constructor(opt_options?: Options) {
        const options = opt_options || {};

        const element = document.createElement('div');
        element.className = 'paper-format';


        super({
            element: element,
            render: (mapEvent) => {
                this.onRender(mapEvent);
            }
        });

        this.printArea = document.createElement('div');
        this.printArea.className = 'print-area';
        this.printArea.id = 'print-area';
        element.appendChild(this.printArea);

        this.set(PrintLayoutProperty.ORIENTATION, options.orientation || ORIENTATION.PORTRAIT);
        this.set(PrintLayoutProperty.FORMAT, options.format || PAPER_FORMAT.A4);
        this.set(PrintLayoutProperty.MARGINS, options.margins || {top: 2, bottom: 2, left: 2, right: 2});
    }

    get paperOrientation() {
        return this.get(PrintLayoutProperty.ORIENTATION);
    }

    set paperOrientation(orientation) {
        if (orientation.toUpperCase() in ORIENTATION) {
            this.set(PrintLayoutProperty.ORIENTATION, orientation.toUpperCase());
            this.setElementSize();
            if (this.getMap()) {
                this.getMap()!.renderSync();
                this.handleBboxChange();
            }
            this.changed();
        } else {
            throw new Error(`orientaion must be one of: ${Object.values(ORIENTATION)}`)
        }
    }

    get paperFormat() {
        return this.get(PrintLayoutProperty.FORMAT);
    }

    set paperFormat(paperFormat) {
        if (paperFormat.toUpperCase() in PAPER_FORMAT) {
            this.set(PrintLayoutProperty.FORMAT, paperFormat.toUpperCase());
            this.setElementSize();
            if (this.getMap()) {
                this.getMap()!.renderSync();
                this.handleBboxChange();
            }
            this.changed();
        } else {
            throw new Error(`paperFormat must be on of: ${Object.values(PAPER_FORMAT)}`)
        }
    }

    get margins(): { top: number, bottom: number, left: number, right: number } {
        return this.get(PrintLayoutProperty.MARGINS);
    }

    set margins(margins ) {
        if(!margins){
            return;
        }

        // no negative values -> set them silently to 0
       let key : keyof typeof margins;
        for ( key in margins) {
            margins[key] = (margins[key] < 0)? 0: margins[key];
        }

        this.set(PrintLayoutProperty.MARGINS, margins);
        this.setElementSize();
        if (this.getMap()) {
            this.getMap()!.renderSync();
            this.handleBboxChange();
        }
        this.changed();
    }

    get bbox() {
        // if not has map -> nothing we can do --> null
        if (!this.getMap()) {
            return null;
        }
        this.getMap()!.renderSync();
        return this.get('bbox');
    }

    get bboxAsLonLat() {
        return (this.bbox) ? transformExtent(this.bbox, 'EPSG:3857', 'EPSG:4326') : null;
    }

    protected computeBbox() {
        // if not has map -> nothing we can do --> null
        if (!this.getMap()) {
            return null;
        }
        const {left: p_left, top: p_top, right: p_right, bottom: p_bottom} = this.printArea.getBoundingClientRect();
        const {x: ol_x, y: ol_y} = this.getMap()!.getViewport().getBoundingClientRect();

        const rel_left = p_left - ol_x,
            rel_top = p_top - ol_y,
            rel_right = p_right - ol_x,
            rel_bottom = p_bottom - ol_y;

        const lowerLeft = this.getMap()!.getCoordinateFromPixel([rel_left, rel_bottom]);
        const upperRight = this.getMap()!.getCoordinateFromPixel([rel_right, rel_top]);

        return [...lowerLeft, ...upperRight];
    }

    getPrintMapScaleDenominator() {
        if (!this.bboxAsLonLat) {
            return null;
        }
        const bbox4326 = this.bboxAsLonLat;
        const lowerLeft = bbox4326.slice(0, 2);
        const lowerRight = bbox4326.slice(2, 4);
        //haversine distance from lower left to lower right corner
        const horizontalDistanceInMeter = getDistance(lowerLeft, lowerRight);
        //width of box in MM
        const {width: widthInMM} = this.getPrintBoxSizeInMM();
        const widthInM = widthInMM / 1000;

        return horizontalDistanceInMeter / widthInM;
    }


    /**
     * Get the print box size (width, height) in dots (px) for printing.
     *
     * This is useful to determine the OGC-WMS params 'WIDTH' and 'HEIGHT'
     * @param dpi {number} the desired print resolution in dots-per-inch (dpi)
     * @returns {{width: number, height: number}}
     */
    getPrintBoxSizeInDots(dpi = 192) {
        const {width: widthInMM, height: heightInMM} = this.getPrintBoxSizeInMM();
        const widthInInch = widthInMM / INCH2MM;
        const heightInInch = heightInMM / INCH2MM;

        return {
            width: Math.round(widthInInch * dpi),
            height: Math.round(heightInInch * dpi)
        }
    }

    getPrintBoxSizeInMM() {
        const {short, long}: { short: number, long: number } = PAPER_SIZE[this.paperFormat];
        const horizontalMarginSum = (this.margins.left + this.margins.right) * 10;
        const verticalMarginSum = (this.margins.top + this.margins.bottom) * 10;

        return (this.paperOrientation === ORIENTATION.PORTRAIT) ? {
            width: short - horizontalMarginSum,
            height: long - verticalMarginSum
        } : {
            width: long - horizontalMarginSum,
            height: short - verticalMarginSum
        };
    }

    //screenPixel
    protected getPrintMarginsInPx(): { top: number; bottom: number; left: number; right: number } {
        const {width, height} = this.element.getBoundingClientRect();
        const {long} = PAPER_SIZE[this.paperFormat];
        const CM2PX_FACTOR = (this.paperOrientation === ORIENTATION.PORTRAIT) ? height / (long / 10) : width / (long / 10);
        let marginsPx = {top: 0, bottom: 0, left: 0, right: 0};
        (Object.keys(this.margins) as (keyof typeof this.margins)[]).forEach((key) => {
            marginsPx[key] = this.margins[key] * CM2PX_FACTOR
        });
        return marginsPx;
    }


    protected getScreenMapAspectRatio() {
        if (!this.getMap()) {
            return 1;
        }
        const [w, h]: Size = this.getMap()!.getSize()!;

        if (h === 0) {
            return Number.MAX_SAFE_INTEGER;
        }
        return w / h;
    }

    protected getPaperMapAspectRatio() {
        const {long, short} = PAPER_SIZE[this.paperFormat];
        return (this.paperOrientation === ORIENTATION.PORTRAIT) ? short / long : long / short;
    }

    protected getRestrictingDimension() {
        return (this.getScreenMapAspectRatio() < this.getPaperMapAspectRatio()) ? 'width' : 'height';
    }

    protected setElementSize() {
        //set size
        if (this.getRestrictingDimension() === 'width') {
            this.element.style.height = '';
            this.element.style.width = '80%';
        } else {
            this.element.style.height = '80%';
            this.element.style.width = '';
        }

        //set aspect ratio
        const {long, short} = PAPER_SIZE[this.paperFormat];
        const aspectRatioPortrait = short / long;

        this.element.style.aspectRatio = String((this.paperOrientation === ORIENTATION.PORTRAIT) ? aspectRatioPortrait : 1 / aspectRatioPortrait);


        //set print box after paper is defined
        this.printArea.style.top = `${this.getPrintMarginsInPx().top}px`;
        this.printArea.style.bottom = `${this.getPrintMarginsInPx().bottom}px`;
        this.printArea.style.left = `${this.getPrintMarginsInPx().left}px`;
        this.printArea.style.right = `${this.getPrintMarginsInPx().right}px`;
    }

    handleBboxChange() {
        this.set(PrintLayoutProperty.BBOX, this.computeBbox())
        this.changed();
    }

    _map: Map | null | undefined;

    onRender(_mapEvent: MapEvent) {

        //register events when the control has a map and starts rendering
        if (!this._map || this._map !== this.getMap()) {
            this._map = this.getMap();
            //register zooming and panning
            const changeViewEvtKey = this.getMap()!.getView().on('change', this.handleBboxChange.bind(this));
            //register resizing of the map container
            const changeMapSizeEvtKey = this.getMap()!.on('change:size', () => {
                this.setElementSize();
                this.handleBboxChange();
            });

            // unregister events when control is removed from map
            this.getMap()!.getControls().once('remove', (e) => {
                if (e.element === this) {
                    this._map!.getView().un('change', changeViewEvtKey.listener);
                    this._map!.un('change:size', changeMapSizeEvtKey.listener);
                    this._map = null;
                }
            });

            //init bbox once the control has a map and is rendered
            this.setElementSize();
            this.set(PrintLayoutProperty.BBOX, this.computeBbox(), true);
            this.dispatchEvent('change');
        }
    }
}

// Expose PrintLayout as ol.control.PrintLayout if using a full build of
// OpenLayers


// @ts-ignore
if (window['ol'] && window['ol']['control']) {
    // @ts-ignore
    window['ol']['control']['PrintLayout'] = PrintLayout;
    // @ts-ignore
    window['PAPER_FORMAT'] = PAPER_FORMAT;
    // @ts-ignore
    window['ORIENTATION'] = ORIENTATION;
}