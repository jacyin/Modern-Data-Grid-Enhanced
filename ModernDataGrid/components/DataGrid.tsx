import React, { Component } from 'react';
import { FilterMatchMode, FilterOperator, addLocale, FilterService } from 'primereact/api';
import { DataTable, DataTableFilterEvent, DataTablePageEvent } from 'primereact/datatable';
import isEqual from 'lodash.isequal';
import { Column } from 'primereact/column';
import { InputText } from 'primereact/inputtext';
import { IconField } from 'primereact/iconfield';
import { InputIcon } from 'primereact/inputicon';
import { IInputs } from "../generated/ManifestTypes";
import { formatDate } from '../helpers/Utils';
import 'primereact/resources/themes/lara-light-blue/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import 'primeflex/primeflex.css';
import "./DataGrid.css";
import { Dropdown } from 'primereact/dropdown';


// Maps Dataverse / PCF data types to the three PrimeReact column filter categories
const getPrimeType = (dataType: string): 'text' | 'numeric' | 'date' => {
    if (["Decimal", "Currency", "FP", "Whole.None", "n"].includes(dataType)) return 'numeric';
    if (dataType.includes("Date")) return 'date';
    return 'text';
};

interface DataGridProps {
    context: ComponentFramework.Context<IInputs>;
    notifyOutputChanged: () => void;
    onHeightChange?: (height: number) => void;
    onRowClick?: (eventName: string, rowData: string) => void;
}

interface DataGridState {
    records: any[];              // Full unfiltered dataset
    filteredRecords: any[];      // Post-filter subset (used for aggregate calculations)
    selectedRecordIds: any[];
    selectedRecords: any[];
    filters: any;                // PrimeReact filter state (controlled)
    globalFilterValue: string;
    columns: ComponentFramework.PropertyHelper.DataSetApi.Column[];
    previousParameters: { [key in keyof IInputs]?: any };
    enabled: boolean;
    needsRefresh: boolean;
    currentPage: number;
    totalPages: number;
    pageSize: number;
    first: number;               // Pagination offset (0-based row index of first visible row)
    sortField: string | null;
    sortOrder: 1 | -1 | 0 | null;
    loadAllPagesInitiated: boolean;
    totalResultCount: number;    // Server-reported total for DataSource mode paginator
}

class DataGrid extends Component<DataGridProps, DataGridState> {
    private intervalId: NodeJS.Timeout | null = null;
    private dt: any = null;
    private _resizeObserver: ResizeObserver | null = null;
    private _cardRef = React.createRef<HTMLDivElement>();
    private _lastReportedHeight: number = 0;
    static contextType = React.createContext<ComponentFramework.Context<IInputs> | undefined>(undefined);
    declare context: React.ContextType<typeof DataGrid.contextType>;

constructor(props: DataGridProps) {
        super(props);

        // JSON data mode uses a larger default page size since the full dataset is always in memory.
        const isUsingJsonData = !!props.context.parameters.jsonData?.raw;
        const pageSize = isUsingJsonData ? 50 : (props.context.parameters.DataSource?.paging?.pageSize || 25);
    const defaultSort = this.resolveDefaultSort(props.context.parameters.DefaultSort?.raw);

        this.state = {
            records: [],
            totalPages: 1,
            selectedRecords: [],
            selectedRecordIds: [],
            filters: this.updateFilters(props.context.parameters.DataSource.columns, {}),
            globalFilterValue: '',
            columns: [],
            previousParameters: {},
            enabled: props.context.parameters.IsEnabled?.raw ?? true,
            needsRefresh: false,
            currentPage: 1,
            filteredRecords: [],
            pageSize,
            first: 0,
            sortField: defaultSort.sortField,
            sortOrder: defaultSort.sortOrder,
            loadAllPagesInitiated: false,
            totalResultCount: 0,
        };
    }

    componentDidMount() {
        // Register custom date filter functions via FilterService so PrimeReact v10's
        // internal filter engine uses them (filterFunction prop on Column is ignored in v10).
        // We extract the date part from ISO strings directly to avoid UTC-offset shifts
        // (e.g. "2020-01-15T00:00:00Z" should compare as Jan 15, not Jan 14 in UTC-5).
        const toDay = (v: any): Date | null => {
            if (v == null) return null;
            if (typeof v === 'string') {
                const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
            }
            const d = v instanceof Date ? v : new Date(v);
            if (isNaN(d.getTime())) return null;
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        };
        FilterService.register('dateIs', (value: any, filter: any) => {
            if (filter == null) return true;
            const field = toDay(value); const cmp = toDay(filter);
            if (!field || !cmp) return true;
            return field.getTime() === cmp.getTime();
        });
        FilterService.register('dateBefore', (value: any, filter: any) => {
            if (filter == null) return true;
            const field = toDay(value); const cmp = toDay(filter);
            if (!field || !cmp) return true;
            return field < cmp;
        });
        FilterService.register('dateAfter', (value: any, filter: any) => {
            if (filter == null) return true;
            const field = toDay(value); const cmp = toDay(filter);
            if (!field || !cmp) return true;
            return field > cmp;
        });

        // Patch the existing 'en' locale with D365-style filter panel labels.
        // Using addLocale('en') merges keys without switching locale, so Calendar
        // month/day names remain intact.
        addLocale('en', {
            matchAll: 'AND',
            matchAny: 'OR',
            addRule: '+ Add row',
            removeRule: 'Remove',
            apply: 'Apply',
            clear: 'Clear',
            contains: 'Contains',
            notContains: 'Not contains',
            startsWith: 'Starts with',
            endsWith: 'Ends with',
            equals: 'Equals',
            notEquals: 'Not equals',
            lt: 'Less than',
            lte: 'Less than or equal',
            gt: 'Greater than',
            gte: 'Greater than or equal',
            dateIs: 'On',
            dateIsNot: 'Not on',
            dateBefore: 'Before',
            dateAfter: 'After',
        });
        const dataSet = this.props.context.parameters.DataSource;
        const jsonData = this.props.context.parameters.jsonData?.raw;

        if (jsonData) {
            this.mapRecordsToState();
        } else if (dataSet && !dataSet.loading) {
            this.mapRecordsToState();
            this.loadAllPages();
        }
        
        this.saveCurrentParametersToState();
        const cardElement = document.querySelector('.card');
        if (cardElement?.parentElement?.parentElement) {
            cardElement.parentElement.parentElement.style.overflowY = 'auto';
            cardElement.parentElement.parentElement.style.overflowX = 'auto';
        }

        // Report rendered height back to Canvas via ContentHeight output property.
        if (this._cardRef.current && this.props.onHeightChange) {
            this._resizeObserver = new ResizeObserver((entries) => {
                const h = Math.ceil(entries[0].contentRect.height);
                if (h > 0 && h !== this._lastReportedHeight) {
                    this._lastReportedHeight = h;
                    this.props.onHeightChange!(h);
                }
            });
            this._resizeObserver.observe(this._cardRef.current);
        }
        this.checkAndStartInterval();
        this.forceRefreshDataset();
    }

    componentWillUnmount() {
        this.clearRefreshInterval();
        this._resizeObserver?.disconnect();
    }

    checkAndStartInterval() {
        if (this.state.needsRefresh) {
            if (!this.intervalId) {
                this.intervalId = setInterval(() => {
                    this.mapRecordsToState();
                }, 5000);
            }
        } else {
            this.clearRefreshInterval();
        }
    }

    clearRefreshInterval() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    saveCurrentParametersToState() {
        const { context } = this.props;
        const parameterValues: { [key in keyof IInputs]?: any } = {};

        Object.keys(context.parameters).forEach((key) => {
            const param = (context.parameters as any)[key];
            if (this.hasRawProperty(param)) {
                parameterValues[key as keyof IInputs] = param.raw;
            }
        });
        this.setState({ previousParameters: parameterValues });
    }

    formatCurrency(value: any, currency: string): string {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency,
        }).format(value);
    }

    formatDecimal(value: any, decimalPlaces: number): string {
        return new Intl.NumberFormat("en-US", {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces,
        }).format(value);
    }

    resolveDefaultSort(defaultSortRaw?: string | null): { sortField: string | null; sortOrder: 1 | -1 | null } {
        const raw = defaultSortRaw?.trim();
        if (!raw) return { sortField: null, sortOrder: null };

        const colonParts = raw.split(':').map(part => part.trim()).filter(Boolean);
        if (colonParts.length >= 2) {
            return {
                sortField: colonParts[0] || null,
                sortOrder: colonParts[1]?.toLowerCase() === 'desc' ? -1 : 1
            };
        }

        const parts = raw.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return {
                sortField: parts[0] || null,
                sortOrder: parts[1]?.toLowerCase() === 'desc' ? -1 : 1
            };
        }

        return { sortField: raw, sortOrder: 1 };
    }

    parseConfigurations(configString: string): Record<string, any> {
        const configs: Record<string, any> = {};
        try {
            const fields = configString.split(",");
            fields.forEach((field) => {
                const [fieldName, config] = field.split("=");
                if (fieldName && config) {
                    const configObject = config.split("|").reduce((acc, pair) => {
                        const firstColonIndex = pair.indexOf(':');
                        if (firstColonIndex === -1) return acc;
                        const key = pair.substring(0, firstColonIndex).trim();
                        const value = pair.substring(firstColonIndex + 1).trim();
                        acc[key] = value;
                        return acc;
                    }, {} as Record<string, any>);
                    configs[fieldName.trim()] = configObject;
                }
            });
        } catch (error) {
            console.error("Error parsing FieldConfigurations:", error);
        }
        return configs;
    }

    calculateAggregates(records: any[], columns: ComponentFramework.PropertyHelper.DataSetApi.Column[], config: any) {
        const aggregates: { [key: string]: { [aggType: string]: string | number } } = {};
        if (!config || Object.keys(config).length === 0) return aggregates;

        const rawFieldConfig = this.props.context.parameters.FieldConfigurations?.raw || "";
        const fieldConfigs = this.parseConfigurations(rawFieldConfig);

        columns.forEach(col => {
            const aggregateType = config[col.name];
            if (!aggregateType) return;

            // Support multiple aggregate types: "sum|avg|max" or just "sum"
            const aggTypes = aggregateType.split('|').map((t: string) => t.trim().toLowerCase()).filter(Boolean);
            if (aggTypes.length === 0) return;

            aggregates[col.name] = {};

            // Only numeric values contribute to aggregations
            const numericValues = records.map((r: any) => r[col.name]).filter((v: any) => typeof v === 'number');

            const specificConfig = fieldConfigs[col.name];

            aggTypes.forEach((type: string) => {
                let rawResult: number | null = null;

                switch (type) {
                    case 'sum': rawResult = numericValues.reduce((a, b) => a + b, 0); break;
                    case 'count': aggregates[col.name][type] = records.length.toString(); return;
                    case 'avg': case 'average': rawResult = numericValues.length > 0 ? (numericValues.reduce((a, b) => a + b, 0) / numericValues.length) : null; break;
                    case 'min': rawResult = numericValues.length > 0 ? Math.min(...numericValues) : null; break;
                    case 'max': rawResult = numericValues.length > 0 ? Math.max(...numericValues) : null; break;
                }

                if (rawResult === null) {
                    aggregates[col.name][type] = '0.00';
                } else {
                    // Mirror body formatter priority: config-driven first, then dataType
                    if (specificConfig?.currency || col.dataType === 'Currency') {
                        aggregates[col.name][type] = this.formatCurrency(rawResult, specificConfig?.currency || 'USD');
                    } else if (specificConfig?.decimalPlaces !== undefined) {
                        aggregates[col.name][type] = this.formatDecimal(rawResult, parseInt(specificConfig.decimalPlaces));
                    } else if (col.dataType === 'Decimal') {
                        aggregates[col.name][type] = this.formatDecimal(rawResult, 2);
                    } else {
                        aggregates[col.name][type] = rawResult.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    }
                }
            });
        });
        return aggregates;
    }

    mapRecordsToState(force = false, preserveFilters = false) {
        const { context } = this.props;
        const dataSet = context.parameters.DataSource as ComponentFramework.PropertyTypes.DataSet;
        const jsonDataParam = context.parameters.jsonData?.raw;

        let records: any[] = [];

        if (jsonDataParam) {
            // --- JSON mode: data is passed as a serialised JSON string from the canvas app ---
            try {
                const parsedJson = JSON.parse(jsonDataParam);
                records = Array.isArray(parsedJson) ? parsedJson : (parsedJson as any)?.value ?? [];
                // Stamp a stable per-row index so dataKey="_rowIndex" always works
                records = records.map((r: any, i: number) => ({ ...r, _rowIndex: i }));
            } catch (error) {
                console.error('Error parsing JSON data:', error);
                records = [];
            }
        } else {
            // --- DataSource mode: load records from the PCF dataset ---
            if (!dataSet || (dataSet.loading && !force)) return;
            if (!dataSet.sortedRecordIds.length) {
                if (dataSet.paging?.loadNextPage) dataSet.paging.loadNextPage();
                return;
            }

            // Prefer dataSet.records (all loaded keys) over sortedRecordIds (current page only)
            const allRecordKeys = Object.keys(dataSet.records);
            const recordIds = allRecordKeys.length > 0 ? allRecordKeys : dataSet.sortedRecordIds;

            records = recordIds.map((recordId) => {
                const record = dataSet.records[recordId];
                if (!record) return null;

                return {
                    id: recordId,
                    ...dataSet.columns.reduce((rec: Record<string, any>, col) => {
                        const value = record.getValue(col.alias);
                        // Store Date objects natively; OptionSet and text values stored as-is.
                        // All display formatting happens in the render body callback.
                        if (col.dataType.includes('Date') && value) {
                            rec[col.name] = new Date(value as any);
                        } else {
                            rec[col.name] = value;
                        }
                        return rec;
                    }, {}),
                };
            }).filter(Boolean);
        }

        this.setState(prevState => {
            const isRecordsChanged = !isEqual(prevState.records, records);
            const isColumnsChanged = !jsonDataParam && !isEqual(prevState.columns, dataSet?.columns);

            // When using JSON and DataSource has no columns (Studio "Add field" not configured),
            // auto-derive columns from the first record's keys.
            let columns = dataSet?.columns || prevState.columns;
            if (jsonDataParam && records.length > 0 && (!columns || columns.length === 0)) {
                const firstRecord = records[0];
                columns = Object.keys(firstRecord)
                    .filter(k => k !== '_rowIndex')
                    .map(k => ({
                        name: k,
                        alias: k,
                        displayName: k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim(),
                        dataType: 'SingleLine.Text',
                        order: 0,
                        visualSizeFactor: 1,
                    })) as any;
                console.log('Auto-derived', columns.length, 'columns from JSON keys');
            }

            if (isRecordsChanged || isColumnsChanged || (jsonDataParam && !isEqual(prevState.columns, columns))) {
                const newFiltered = preserveFilters ? this.applyCurrentFilters(records) : records;
                return {
                    records,
                    filteredRecords: newFiltered,
                    columns,
                    needsRefresh: false
                };
            }
            return null;
        });
    }

    applyCurrentFilters(records: any[]) {
        if (!records || !records.length) return records;

        const global = this.state.globalFilterValue?.toString().toLowerCase() || '';
        const filters = this.state.filters || {};

        const toDay = (v: any): Date | null => {
            if (v == null) return null;
            if (typeof v === 'string') {
                const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
            }
            const d = v instanceof Date ? v : new Date(v);
            if (isNaN(d.getTime())) return null;
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        };

        const toNumber = (v: any): number | null => {
            if (v == null || v === '') return null;
            if (typeof v === 'number') return isNaN(v) ? null : v;
            const parsed = Number(v);
            return isNaN(parsed) ? null : parsed;
        };

        const matchesConstraint = (fieldValue: any, constraint: any): boolean => {
            if (!constraint) return true;
            const value = constraint.value;
            const matchMode = constraint.matchMode;
            if (value == null || value === '') return true;
            if (fieldValue == null) return false;

            const filterFn = (FilterService as any)?.filters?.[matchMode];
            if (typeof filterFn === 'function') {
                try {
                    return !!filterFn(fieldValue, value, this.props.context.userSettings?.languageId?.toString());
                } catch {
                    // Fallback below
                }
            }

            const fieldStr = String(fieldValue).toLowerCase();
            const cmp = String(value).toLowerCase();
            switch (matchMode) {
                case FilterMatchMode.IN: {
                    if (!Array.isArray(value)) return false;
                    return value.some(v => String(fieldValue).toLowerCase() === String(v).toLowerCase());
                }
                case FilterMatchMode.BETWEEN: {
                    if (!Array.isArray(value) || value.length < 2) return true;
                    const nField = toNumber(fieldValue);
                    const nStart = toNumber(value[0]);
                    const nEnd = toNumber(value[1]);
                    if (nField != null && nStart != null && nEnd != null) return nField >= nStart && nField <= nEnd;
                    const dField = toDay(fieldValue);
                    const dStart = toDay(value[0]);
                    const dEnd = toDay(value[1]);
                    if (dField && dStart && dEnd) return dField >= dStart && dField <= dEnd;
                    return false;
                }
                case FilterMatchMode.LESS_THAN: {
                    const nField = toNumber(fieldValue); const nCmp = toNumber(value);
                    if (nField != null && nCmp != null) return nField < nCmp;
                    const dField = toDay(fieldValue); const dCmp = toDay(value);
                    if (dField && dCmp) return dField < dCmp;
                    return fieldStr < cmp;
                }
                case FilterMatchMode.LESS_THAN_OR_EQUAL_TO: {
                    const nField = toNumber(fieldValue); const nCmp = toNumber(value);
                    if (nField != null && nCmp != null) return nField <= nCmp;
                    const dField = toDay(fieldValue); const dCmp = toDay(value);
                    if (dField && dCmp) return dField <= dCmp;
                    return fieldStr <= cmp;
                }
                case FilterMatchMode.GREATER_THAN: {
                    const nField = toNumber(fieldValue); const nCmp = toNumber(value);
                    if (nField != null && nCmp != null) return nField > nCmp;
                    const dField = toDay(fieldValue); const dCmp = toDay(value);
                    if (dField && dCmp) return dField > dCmp;
                    return fieldStr > cmp;
                }
                case FilterMatchMode.GREATER_THAN_OR_EQUAL_TO: {
                    const nField = toNumber(fieldValue); const nCmp = toNumber(value);
                    if (nField != null && nCmp != null) return nField >= nCmp;
                    const dField = toDay(fieldValue); const dCmp = toDay(value);
                    if (dField && dCmp) return dField >= dCmp;
                    return fieldStr >= cmp;
                }
                case FilterMatchMode.EQUALS:
                    return fieldStr === cmp;
                case FilterMatchMode.NOT_EQUALS:
                    return fieldStr !== cmp;
                case FilterMatchMode.STARTS_WITH:
                    return fieldStr.startsWith(cmp);
                case FilterMatchMode.ENDS_WITH:
                    return fieldStr.endsWith(cmp);
                case FilterMatchMode.NOT_CONTAINS:
                    return !fieldStr.includes(cmp);
                case FilterMatchMode.DATE_IS: {
                    const dField = toDay(fieldValue); const dCmp = toDay(value);
                    if (!dField || !dCmp) return false;
                    return dField.getTime() === dCmp.getTime();
                }
                case FilterMatchMode.DATE_IS_NOT: {
                    const dField = toDay(fieldValue); const dCmp = toDay(value);
                    if (!dField || !dCmp) return false;
                    return dField.getTime() !== dCmp.getTime();
                }
                case FilterMatchMode.DATE_BEFORE: {
                    const dField = toDay(fieldValue); const dCmp = toDay(value);
                    if (!dField || !dCmp) return false;
                    return dField < dCmp;
                }
                case FilterMatchMode.DATE_AFTER: {
                    const dField = toDay(fieldValue); const dCmp = toDay(value);
                    if (!dField || !dCmp) return false;
                    return dField > dCmp;
                }
                case FilterMatchMode.CONTAINS:
                default:
                    return fieldStr.includes(cmp);
            }
        };

        const filtered = records.filter(record => {
            // Global filter check
            if (global) {
                const anyFieldMatches = Object.keys(record).some(k => {
                    const val = record[k];
                    if (val == null) return false;
                    return String(val).toLowerCase().includes(global);
                });
                if (!anyFieldMatches) return false;
            }

            // Per-field filters
            for (const key of Object.keys(filters)) {
                if (key === 'global') continue;
                const f = filters[key];
                const fieldVal = record[key];
                const constraints = (f?.constraints && f.constraints.length > 0
                    ? f.constraints
                    : (f && (f.value != null || f.matchMode)
                        ? [{ value: f.value, matchMode: f.matchMode }]
                        : []))
                    .filter((c: any) => c && c.value != null && c.value !== '');
                if (!constraints.length) continue;

                const operator = (f?.operator || FilterOperator.AND) as string;
                const matches = constraints.map((c: any) => matchesConstraint(fieldVal, c));
                const passed = operator === FilterOperator.OR ? matches.some(Boolean) : matches.every(Boolean);
                if (!passed) return false;
            }

            return true;
        });

        return filtered;
    }

    /** Initialises per-column filter state, choosing the correct matchMode based on
     * the column's dataType and any type: override set in FieldConfigurations.
     * Pass an empty object for previousFilters to reset all filters from scratch. */
    updateFilters(columns: ComponentFramework.PropertyHelper.DataSetApi.Column[], previousFilters: any) {
        const rawFieldConfig = this.props.context.parameters.FieldConfigurations?.raw || "";
        const fieldConfigs = this.parseConfigurations(rawFieldConfig);

        return columns.reduce((acc: any, col: any) => {
            if (previousFilters[col.name]) {
                acc[col.name] = previousFilters[col.name];
            } else {
                const configType = fieldConfigs[col.name]?.type?.toLowerCase();
                const type = getPrimeType(col.dataType);
                const isOptionSet = col.dataType === 'OptionSet' || col.dataType === 'TwoOptions' || col.dataType === 'MultiSelectPicklist' || configType === 'optionset';
                let matchMode = FilterMatchMode.CONTAINS;
                if (type === 'numeric') matchMode = FilterMatchMode.EQUALS;
                if (type === 'date' || configType === 'date') matchMode = FilterMatchMode.DATE_IS;
                if (isOptionSet) matchMode = FilterMatchMode.EQUALS;

                // Apply defaultFilter: value from FieldConfigurations if present.
                // Supports dynamic keywords (today/yesterday/thisweek/lastweek/thismonth/lastmonth/
                // thisquarter/lastquarter/thisyear/lastyear), explicit ranges (2026-01-01..2026-03-31),
                // and plain single values. Keywords and ranges produce two constraints (DATE_AFTER +
                // DATE_BEFORE) so the filter panel shows both rows correctly.
                const defaultFilterRaw = fieldConfigs[col.name]?.defaultFilter;
                const defaultFilterMode = fieldConfigs[col.name]?.defaultFilterMode;
                const modeMap: Record<string, string> = {
                    contains: FilterMatchMode.CONTAINS,
                    notcontains: FilterMatchMode.NOT_CONTAINS,
                    startswith: FilterMatchMode.STARTS_WITH,
                    endswith: FilterMatchMode.ENDS_WITH,
                    equals: FilterMatchMode.EQUALS,
                    notequals: FilterMatchMode.NOT_EQUALS,
                    dateis: FilterMatchMode.DATE_IS,
                    dateisnot: FilterMatchMode.DATE_IS_NOT,
                    datebefore: FilterMatchMode.DATE_BEFORE,
                    dateafter: FilterMatchMode.DATE_AFTER,
                };

                // Parses a YYYY-MM-DD string as a local midnight Date (avoids UTC-offset shift).
                const parseLocalDate = (s: string): Date => {
                    const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
                    return m ? new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])) : new Date(s.trim());
                };
                // Adds/subtracts days without mutating the original.
                const addDays = (d: Date, n: number): Date => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

                // Resolves a defaultFilter raw string to an array of {value, matchMode} constraints.
                const resolveDefaultFilter = (raw: string): Array<{value: any, matchMode: string}> | null => {
                    if (!raw) return null;
                    const isDate = type === 'date' || configType === 'date';

                    if (isDate) {
                        const keyword = raw.trim().toLowerCase();
                        const now = new Date();
                        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                        // Builds an AND range: field > afterDate AND field < beforeDate (inclusive endpoints).
                        const range = (start: Date, end: Date) => [
                            { value: addDays(start, -1), matchMode: FilterMatchMode.DATE_AFTER },
                            { value: addDays(end,    1), matchMode: FilterMatchMode.DATE_BEFORE },
                        ];
                        switch (keyword) {
                            case 'today':
                                return [{ value: today, matchMode: FilterMatchMode.DATE_IS }];
                            case 'yesterday':
                                return [{ value: addDays(today, -1), matchMode: FilterMatchMode.DATE_IS }];
                            case 'thisweek': {
                                const start = addDays(today, -today.getDay());
                                return range(start, addDays(start, 6));
                            }
                            case 'lastweek': {
                                const thisStart = addDays(today, -today.getDay());
                                const start = addDays(thisStart, -7);
                                return range(start, addDays(start, 6));
                            }
                            case 'thismonth': {
                                const start = new Date(today.getFullYear(), today.getMonth(), 1);
                                const end   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                                return range(start, end);
                            }
                            case 'lastmonth': {
                                const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                                const end   = new Date(today.getFullYear(), today.getMonth(), 0);
                                return range(start, end);
                            }
                            case 'thisquarter': {
                                const q = Math.floor(today.getMonth() / 3);
                                const start = new Date(today.getFullYear(), q * 3, 1);
                                const end   = new Date(today.getFullYear(), q * 3 + 3, 0);
                                return range(start, end);
                            }
                            case 'lastquarter': {
                                const q = Math.floor(today.getMonth() / 3);
                                const lq = q === 0 ? 3 : q - 1;
                                const ly = q === 0 ? today.getFullYear() - 1 : today.getFullYear();
                                const start = new Date(ly, lq * 3, 1);
                                const end   = new Date(ly, lq * 3 + 3, 0);
                                return range(start, end);
                            }
                            case 'thisyear': {
                                const start = new Date(today.getFullYear(), 0, 1);
                                const end   = new Date(today.getFullYear(), 11, 31);
                                return range(start, end);
                            }
                            case 'lastyear': {
                                const start = new Date(today.getFullYear() - 1, 0, 1);
                                const end   = new Date(today.getFullYear() - 1, 11, 31);
                                return range(start, end);
                            }
                            default:
                                // Explicit range: "2026-01-01..2026-03-31"
                                if (raw.includes('..')) {
                                    const [s, e] = raw.split('..');
                                    return range(parseLocalDate(s), parseLocalDate(e));
                                }
                                // Single date value
                                return [{ value: parseLocalDate(raw), matchMode: modeMap[defaultFilterMode?.toLowerCase() ?? ''] ?? FilterMatchMode.DATE_IS }];
                        }
                    }

                    // Non-date types: single value
                    let defaultValue: any = raw;
                    if (type === 'numeric') { const n = parseFloat(raw); if (!isNaN(n)) defaultValue = n; }
                    const resolvedMode = modeMap[defaultFilterMode?.toLowerCase() ?? ''] ?? matchMode;
                    return [{ value: defaultValue, matchMode: resolvedMode }];
                };

                const defaultConstraints = resolveDefaultFilter(defaultFilterRaw);
                acc[col.name] = {
                    operator: FilterOperator.AND,
                    constraints: defaultConstraints ?? [{ value: null, matchMode: defaultFilterMode ? (modeMap[defaultFilterMode.toLowerCase()] ?? matchMode) : matchMode }]
                };
            }
            return acc;
        }, {});
    }

    componentDidUpdate(prevProps: Readonly<DataGridProps>, prevState: Readonly<DataGridState>): void {
        const { context } = this.props;
        const dataSet = context.parameters.DataSource as ComponentFramework.PropertyTypes.DataSet;
        const jsonData = context.parameters.jsonData?.raw;
        const prevJsonData = prevProps.context.parameters.jsonData?.raw;
        const defaultSortChanged = (prevProps.context.parameters.DefaultSort?.raw || '') !== (this.props.context.parameters.DefaultSort?.raw || '');

        const recordsCount = Object.keys(dataSet?.records || {}).length;

        if (defaultSortChanged) {
            const defaultSort = this.resolveDefaultSort(this.props.context.parameters.DefaultSort?.raw);
            if (defaultSort.sortField !== this.state.sortField || defaultSort.sortOrder !== this.state.sortOrder || this.state.first !== 0) {
                this.setState({
                    sortField: defaultSort.sortField,
                    sortOrder: defaultSort.sortOrder,
                    first: 0
                });
                return;
            }
        }
        
        // If JSON data is present, always use it - never fall through to DataSource processing
        if (jsonData) {
            const fieldConfigurationsChanged = (prevProps.context.parameters.FieldConfigurations?.raw || "") !== (this.props.context.parameters.FieldConfigurations?.raw || "");
            if (jsonData !== prevJsonData || this.state.records.length === 0) {
                this.mapRecordsToState(true, false);
            } else if (fieldConfigurationsChanged) {
                // FieldConfigurations changed (e.g. type:optionset added) — rebuild filter match modes
                const cols = this.state.columns.length > 0 ? this.state.columns : dataSet?.columns || [];
                const newFilters = this.updateFilters(cols as any, {});
                this.setState({ filters: newFilters });
            }
            return;
        }
        
        // Check if we have data available and haven't initiated page loading yet.
        // Check both records and sortedRecordIds — canvas apps sometimes populate one before the other.
        const sortedCount = dataSet?.sortedRecordIds?.length ?? 0;
        if (!dataSet?.loading && !this.state.loadAllPagesInitiated && (recordsCount > 0 || sortedCount > 0)) {
            this.setState({ loadAllPagesInitiated: true });
            this.mapRecordsToState();
            this.loadAllPages();
            return;
        }

        if (!dataSet || dataSet.loading) return;

        const dataSourceChanged = prevProps.context.parameters.DataSource !== this.props.context.parameters.DataSource;
        const sortedRecordIdsChanged = JSON.stringify(prevProps.context.parameters.DataSource.sortedRecordIds) !== JSON.stringify(dataSet.sortedRecordIds);
        const fieldConfigurationsChanged = (prevProps.context.parameters.FieldConfigurations?.raw || "") !== (this.props.context.parameters.FieldConfigurations?.raw || "");

        if (dataSourceChanged || sortedRecordIdsChanged || fieldConfigurationsChanged) {
            this.setState({ loadAllPagesInitiated: false });
            if (fieldConfigurationsChanged) {
                const newFilters = this.updateFilters(dataSet.columns, {});
                this.setState({ filters: newFilters });
            }
        }

        if (!this.areColumnsEqual(prevState.columns, dataSet.columns)) {
            const newFilters = this.updateFilters(dataSet.columns, prevState.filters);
            if (JSON.stringify(prevState.filters) !== JSON.stringify(newFilters)) {
                this.setState({ filters: newFilters, needsRefresh: true, loadAllPagesInitiated: false });
                this.mapRecordsToState();
                this.forceRefreshDataset();
            }
        }

        if (prevState.needsRefresh !== this.state.needsRefresh) {
            this.checkAndStartInterval();
            this.forceRefreshDataset();
        }

        if (!this.state.records.length && !dataSet.loading) {
            this.mapRecordsToState();
        }
    }

    hasRawProperty(param: any): param is { raw: any } {
        return param && typeof param === 'object' && 'raw' in param;
    }

    areColumnsEqual(currentColumns: ComponentFramework.PropertyHelper.DataSetApi.Column[], nextColumns: ComponentFramework.PropertyHelper.DataSetApi.Column[]): boolean {
        if (currentColumns.length !== nextColumns.length) return false;
        for (let i = 0; i < currentColumns.length; i++) {
            if (currentColumns[i].name !== nextColumns[i].name || currentColumns[i].displayName !== nextColumns[i].displayName) return false;
        }
        return true;
    }

    shouldComponentUpdate(nextProps: Readonly<DataGridProps>, nextState: Readonly<DataGridState>): boolean {
        const parameterKeys: (keyof IInputs)[] = Object.keys(nextProps.context.parameters) as (keyof IInputs)[];
        if (nextState.needsRefresh) this.props.context.parameters.DataSource.refresh();

        for (const key of parameterKeys) {
            const nextParam = nextProps.context.parameters[key];
            const previousParam = this.state.previousParameters[key];
            if (this.hasRawProperty(nextParam) && previousParam !== nextParam.raw) return true;
        }

        if (!this.areColumnsEqual(this.state.columns, nextProps.context.parameters.DataSource.columns)) return true;
        if (JSON.stringify(this.state.filters) !== JSON.stringify(nextState.filters)) return true;

        // Re-render on any user-interaction state changes
        if (nextState.sortField !== this.state.sortField) return true;
        if (nextState.sortOrder !== this.state.sortOrder) return true;
        if (nextState.first !== this.state.first) return true;
        if (nextState.pageSize !== this.state.pageSize) return true;
        if (nextState.records !== this.state.records) return true;

        return false;
    }

    onGlobalFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        this.setState({
            globalFilterValue: value,
            filters: { ...this.state.filters, global: { value, matchMode: FilterMatchMode.CONTAINS } }
        });
    };

    dateFilterTemplate = (options: any) => {
        // Convert stored Date/ISO-string value to yyyy-mm-dd for native input
        let isoDate = '';
        if (options.value) {
            const d = options.value instanceof Date ? options.value : new Date(options.value);
            if (!isNaN(d.getTime())) {
                isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
        }
        return (
            <input
                type="date"
                value={isoDate}
                onChange={(e) => {
                    const val = e.target.value;
                    // Parse as local date (avoid UTC-shift by appending local midnight)
                    options.filterCallback(val ? new Date(val + 'T00:00:00') : null, options.index);
                }}
                style={{
                    width: '100%', height: '28px',
                    border: '1px solid #8a8886', borderRadius: '2px',
                    fontSize: '13px', fontFamily: "'Segoe UI', system-ui, sans-serif",
                    padding: '0 6px', color: '#323130',
                    boxSizing: 'border-box', outline: 'none',
                }}
            />
        );
    };

    // Custom filter function for date columns — normalises ISO strings and Date objects
    // before comparing, so JSON string dates (e.g. "2024-01-15T00:00:00Z") work correctly.
    dateFilterFunction = (value: any, filter: any, filterMatchMode: string): boolean => {
        if (filter == null) return true;
        const toDay = (v: any) => {
            const d = v instanceof Date ? v : new Date(v);
            if (isNaN(d.getTime())) return null;
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        };
        const fieldDay = toDay(value);
        const cmpDay  = toDay(filter);
        if (!fieldDay || !cmpDay) return false;
        switch (filterMatchMode) {
            case FilterMatchMode.DATE_IS:     return fieldDay.getTime() === cmpDay.getTime();
            case FilterMatchMode.DATE_IS_NOT: return fieldDay.getTime() !== cmpDay.getTime();
            case FilterMatchMode.DATE_BEFORE: return fieldDay < cmpDay;
            case FilterMatchMode.DATE_AFTER:  return fieldDay > cmpDay;
            default: return true;
        }
    };

    // Returns a Dropdown filter for OptionSet / TwoOptions columns, populated from distinct values in the current records.
    optionSetFilterTemplate = (colName: string) => (options: any) => {
        const distinctValues = Array.from(
            new Set(this.state.records.map((r: any) => r[colName]).filter((v: any) => v != null && v !== ''))
        ).sort().map((v: any) => ({ label: String(v), value: String(v) }));

        return (
            <Dropdown
                value={options.value}
                options={distinctValues}
                onChange={(e) => options.filterCallback(e.value, options.index)}
                placeholder="Select..."
                showClear
                style={{ minWidth: '10rem' }}
            />
        );
    };

    renderHeader() {
        const displayHeader = this.props.context.parameters.DisplayHeader?.raw ?? false;
        const displaySearch = this.props.context.parameters.DisplaySearch?.raw ?? false;
        const headerText = this.props.context.parameters.HeaderText?.raw ?? this.props.context.parameters.DataSource.getTargetEntityType();

        if (!displayHeader && !displaySearch) return null;

        return (
            <div className="flex flex-wrap gap-2 justify-content-between align-items-center">
                {displayHeader && <h4 className="m-0">{headerText}</h4>}
                {displaySearch && (
                    <IconField iconPosition="left">
                        <InputIcon className="pi pi-search" />
                        <InputText value={this.state.globalFilterValue} onChange={this.onGlobalFilterChange} placeholder="Keyword Search" />
                    </IconField>
                )}
            </div>
        );
    }

    forceRefreshDataset = () => {
        setTimeout(() => {
            this.props.notifyOutputChanged();
            this.mapRecordsToState(true);
            this.forceUpdate();
        }, 300);
    };

    onFilterChange = (e: any) => {
        // With lazy=false, PrimeReact handles filtering client-side internally.
        // We store the filter state so aggregates can be recomputed in render.
        this.setState({ filters: e.filters, first: 0 });
    };

    onPageChange = (e: any) => {
        // Full dataset is always in memory (both JSON and DataSource modes) — pure client-side pagination
        const newState: any = {};
        if (e.first !== undefined) newState.first = e.first;
        if (e.rows && e.rows !== this.state.pageSize) {
            newState.pageSize = e.rows;
            if (e.first === undefined) newState.first = 0;
        }
        if (Object.keys(newState).length > 0) this.setState(newState);
    };

    onSortChange = (e: any) => {
        this.setState({
            sortField: e.sortField ?? null,
            sortOrder: e.sortOrder ?? null,
            first: 0
        });
    };

    onRowClickHandler = (e: { data: any }) => {
        if (this.props.onRowClick) {
            // Strip internal _rowIndex key before exposing to Canvas
            const { _rowIndex, ...rowData } = e.data;
            this.props.onRowClick('rowClick', JSON.stringify(rowData));
        }
    };

    loadAllPages = () => {
        const { context } = this.props;
        const jsonDataParam = context.parameters.jsonData?.raw;

        // JSON mode: the full dataset is already in memory, no paging needed.
        if (jsonDataParam) {
            this.mapRecordsToState(true, false);
            return;
        }

        // DataSource mode: iterate through all pages by calling loadNextPage() repeatedly.
        // After each call the PCF framework delivers the next page via updateView(),
        // so we poll until the record count grows before advancing again.
        const dataSet = context.parameters.DataSource as ComponentFramework.PropertyTypes.DataSet;

        let previousRecordCount = Object.keys(dataSet?.records || {}).length;
        let waitAttempts = 0;
        const maxWaitPerPage = 30;  // 30 × 500 ms = 15 s max wait per page
        const maxTotalPages = 200;  // Safety cap (~20 000 records at 100/page)
        let pagesLoaded = 0;

        const advance = () => {
            const freshDataSet = this.props.context.parameters.DataSource as ComponentFramework.PropertyTypes.DataSet;
            const currentCount = Object.keys(freshDataSet?.records || {}).length;

            // Wait for record count to grow after the last loadNextPage() call
            if (currentCount <= previousRecordCount && waitAttempts < maxWaitPerPage) {
                waitAttempts++;
                setTimeout(advance, 500);
                return;
            }

            previousRecordCount = currentCount;
            waitAttempts = 0;

            if (freshDataSet?.paging?.hasNextPage && pagesLoaded < maxTotalPages) {
                pagesLoaded++;
                freshDataSet.paging.loadNextPage();
                setTimeout(advance, 500);
            } else {
                // All pages loaded (or cap reached) — render the full dataset
                this.mapRecordsToState(true, false);
            }
        };

        if (dataSet?.paging?.hasNextPage) {
            pagesLoaded++;
            dataSet.paging.loadNextPage();
            setTimeout(advance, 500);
        } else {
            this.mapRecordsToState(true, false);
        }
    };

    extractBaseUrl(fullUrl: string): string {
        try {
            const url = new URL(fullUrl);
            return `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
        } catch (error) {
            return '';
        }
    }

    getFilterMatchModes(dataType: string) {
        const isOptionSet = dataType === 'OptionSet' || dataType === 'TwoOptions' || dataType === 'MultiSelectPicklist';

        if (isOptionSet) {
            return [{ label: 'Equals', value: FilterMatchMode.EQUALS }];
        }

        if (getPrimeType(dataType) === 'date') {
            return [
                { label: 'On',     value: FilterMatchMode.DATE_IS },
                { label: 'Before', value: FilterMatchMode.DATE_BEFORE },
                { label: 'After',  value: FilterMatchMode.DATE_AFTER },
            ];
        }

        // Default: text match modes only
        return undefined; // Let PrimeReact use its built-in text operators
    }


    getColumnsToDisplay() {
        const { context } = this.props;
        try {
            return context.parameters.DataSource.columns || [];
        } catch (e) {
            // DataSource.columns unavailable (e.g. JSON-only mode with no fields added in Studio)
            if (this.state.records && this.state.records.length > 0) {
                const firstRecord = this.state.records[0];
                return Object.keys(firstRecord).map(key => ({
                    name: key,
                    displayName: key.charAt(0).toUpperCase() + key.slice(1),
                    dataType: 'SingleLine.Text',
                    alias: key,
                } as any));
            }
            return [];
        }
    }

    render() {
        const { context } = this.props;
        const paging = context.parameters.DataSource?.paging;
        const { records, filters } = this.state;
        const rawFieldConfig = context.parameters.FieldConfigurations?.raw || "";
        const fieldConfigs = this.parseConfigurations(rawFieldConfig);

        const displayPagination = context.parameters.DisplayPagination?.raw ?? true;
        const emptyMessage = context.parameters.EmptyMessage?.raw ?? "No records found.";
        const allowSorting = context.parameters.AllowSorting?.raw ?? false;
        const allowFiltering = context.parameters.AllowFiltering?.raw ?? false;
        const shrinkToFit = context.parameters.ShrinkToFit?.raw ?? false;

        const hasActiveFilters = this.state.globalFilterValue || 
            Object.keys(this.state.filters || {}).some(k => 
                k !== 'global' && this.state.filters[k]?.constraints?.[0]?.value != null && this.state.filters[k]?.constraints?.[0]?.value !== ''
            );

        // Compute filtered records inline (for aggregates + totalCount) from current filter state.
        // This avoids storing filteredRecords as state (which caused a re-render feedback loop with PrimeReact).
        const displayedRecords = hasActiveFilters ? this.applyCurrentFilters(records) : records;

        // Full dataset is always in memory for both modes — PrimeReact handles sort/filter client-side.
        // JSON mode: records.length is authoritative. DataSource mode: prefer server total once all pages loaded.
        const isUsingJsonData = !!context.parameters.jsonData?.raw;
        const totalCount = hasActiveFilters
            ? displayedRecords.length
            : (isUsingJsonData ? records.length : (paging?.totalResultCount && paging.totalResultCount > 0 ? paging.totalResultCount : records.length));

        const showAggregates = context.parameters.showAggregates?.raw ?? false;
        const aggregateConfigRaw = context.parameters.aggregateConfig?.raw ?? '';
        let aggregateConfig: { [key: string]: string } = {};
        try { aggregateConfig = JSON.parse(aggregateConfigRaw); } catch (e) { /* ignore invalid JSON */ }

        const columns = this.getColumnsToDisplay();
        // Columns the user wants hidden (still in FieldConfigurations for aggregates/formatting, just not displayed)
        const visibleColumns = columns.filter(col => fieldConfigs[col.name]?.hidden !== 'true');
        const aggregates = showAggregates ? this.calculateAggregates(displayedRecords, visibleColumns, aggregateConfig) : {};

        // Build aggregate summary as a single horizontal row for paginatorLeft
        let paginatorLeft: React.ReactNode | undefined;
        if (showAggregates && Object.keys(aggregates).length > 0) {
            const items = visibleColumns
                .filter(col => aggregates[col.name] && Object.keys(aggregates[col.name]).length > 0)
                .map((col, i, arr) => {
                    const aggObj = aggregates[col.name];
                    const aggDisplay = Object.entries(aggObj)
                        .map(([type, val]: [string, any]) => `${type}=${val}`)
                        .join(', ');
                    return (
                        <span key={col.name} style={{ whiteSpace: 'nowrap' }}>
                            <span style={{ fontWeight: 600 }}>{col.displayName}:</span>{' '}{aggDisplay}
                            {i < arr.length - 1 && <span style={{ margin: '0 10px', color: '#d0d0d0' }}>|</span>}
                        </span>
                    );
                });
            if (items.length > 0) paginatorLeft = <div style={{ fontSize: '13px', color: '#323130', padding: '0 4px' }}>{items}</div>;
        }
        // Only use space-between layout when aggregates are present; otherwise right-align controls with flex-end
        const hasAggregates = !!paginatorLeft;
        const paginatorLeftSlot = paginatorLeft;

        const header = this.renderHeader();



        // Option C: minimum usable height — ~5 rows (44px each) + paginator (44px) + header row (44px) + buffer = 300px.
        // If allocatedHeight from the PCF container is larger, use that; otherwise enforce the minimum so rows
        // are never silently clipped. The card may overflow its container on small screens, but the page
        // scroll in Model Driven App will still let users reach all rows.
        const MIN_GRID_HEIGHT = 300;
        const allocatedHeight = (context.mode as any).allocatedHeight as number | undefined;
        const effectiveHeight = (!shrinkToFit && allocatedHeight && allocatedHeight > MIN_GRID_HEIGHT)
            ? allocatedHeight
            : (!shrinkToFit ? MIN_GRID_HEIGHT : undefined);
        const cardHeight = shrinkToFit ? 'fit-content' : `${effectiveHeight}px`;

        return (
            <div ref={this._cardRef} className="card" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: cardHeight, overflowY: shrinkToFit ? 'visible' : 'auto', overflowX: shrinkToFit ? 'visible' : 'auto' }}>
<DataTable
    ref={(el) => this.dt = el}
    value={records}
    lazy={false}  // Full dataset in memory — PrimeReact handles all filtering, sorting, pagination
    paginator={displayPagination}
    paginatorClassName={hasAggregates ? 'mdg-paginator mdg-paginator-aggregates' : 'mdg-paginator'}
    paginatorLeft={paginatorLeftSlot}
    header={header}
    onFilter={this.onFilterChange}
    onPage={this.onPageChange}
    onSort={this.onSortChange}
    onRowClick={this.onRowClickHandler}
    rowClassName={() => ({ 'mdg-row-clickable': !!this.props.onRowClick })}
    sortField={this.state.sortField ?? undefined}
    sortOrder={this.state.sortOrder ?? undefined}
    first={this.state.first}
    rows={this.state.pageSize}
    paginatorPosition="top"
    paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport RowsPerPageDropdown"
    rowsPerPageOptions={[15, 25, 50, 100]}
    dataKey="_rowIndex"
    filters={filters}
    filterDisplay="menu"
    globalFilterFields={visibleColumns.map(col => col.name)}
    emptyMessage={emptyMessage}
    currentPageReportTemplate="Showing {first} to {last} of {totalRecords} entries"
    scrollable={!shrinkToFit}
    scrollHeight={shrinkToFit ? undefined : 'flex'}
    style={{ width: '100%', minWidth: '0', ...(shrinkToFit ? {} : { flex: 1, overflow: 'hidden' }) }}
>
                    {visibleColumns.map((col, index) => {
                    const colConfig = fieldConfigs[col.name];
                    // Allow FieldConfigurations type: override for JSON columns (e.g. status=type:optionset, invoiceDate=type:date)
                    const configType = colConfig?.type?.toLowerCase();
                    const primeType = getPrimeType(col.dataType);
                    const isNumeric = primeType === 'numeric';
                    const textAlign = isNumeric ? 'right' : 'left';
                    const isDate = primeType === 'date' || configType === 'date';
                    const isOptionSet = col.dataType === 'OptionSet' || col.dataType === 'TwoOptions' || col.dataType === 'MultiSelectPicklist' || configType === 'optionset';

                        // Column width priority: FieldConfigurations width: > visualSizeFactor > per-type default
                        // Cap visualSizeFactor at 2 and max derived width at 300px to prevent very wide columns.
                        const baseWidthPx = isNumeric ? 90 : isDate ? 120 : 150;
                        const factor = Math.min((col as any).visualSizeFactor || 1, 2);
                        const derivedWidth = `${Math.min(Math.round(baseWidthPx * factor), 300)}px`;
                        const colWidth = colConfig?.width || derivedWidth;

                        return (
                            <Column
                                key={index}
                                field={col.name}
                                header={col.displayName}
                                dataType={isDate ? 'text' : primeType}
                                sortable={allowSorting}
                                filter={allowFiltering}
                                filterElement={isDate ? this.dateFilterTemplate : isOptionSet ? this.optionSetFilterTemplate(col.name) : undefined}
                                filterMatchModeOptions={this.getFilterMatchModes(col.dataType)}
                                filterPlaceholder={`Search by ${col.displayName}`}
                                showFilterMatchModes={!isOptionSet}
                                maxConstraints={5}
                                style={{ width: colWidth, minWidth: colWidth, textAlign: textAlign }}
                                headerClassName={isNumeric ? 'mdg-col-numeric' : undefined}
                                body={(rowData) => {
                                    const rawValue = rowData[col.name];

                                    // Display formatting
                                    let formattedDisplay = rawValue;
                                    if (rawValue != null && rawValue !== "") {
                                        // Config-driven overrides take precedence over dataType defaults
                                        if (colConfig?.currency) {
                                            formattedDisplay = this.formatCurrency(rawValue, colConfig.currency);
                                        } else if (col.dataType === 'Currency') {
                                            formattedDisplay = this.formatCurrency(rawValue, colConfig?.currency || "USD");
                                        } else if (colConfig?.decimalPlaces !== undefined) {
                                            formattedDisplay = this.formatDecimal(rawValue, parseInt(colConfig.decimalPlaces));
                                        } else if (isNumeric && col.dataType === 'Decimal') {
                                            formattedDisplay = this.formatDecimal(rawValue, 2);
                                        } else if (isNumeric) {
                                            formattedDisplay = this.formatDecimal(rawValue, parseInt(colConfig?.decimalPlaces) || 2);
                                        } else if (colConfig?.dateFormat || colConfig?.type === 'date' || rawValue instanceof Date || (col.dataType.includes('Date') && typeof rawValue === 'string' && rawValue)) {
                                            const dateVal = rawValue instanceof Date ? rawValue : new Date(rawValue);
                                            if (!isNaN(dateVal.getTime())) {
                                                formattedDisplay = formatDate(dateVal, colConfig?.dateFormat || "MM/dd/yyyy", context);
                                            }
                                        } else if (col.dataType === "TwoOptions") {
                                            formattedDisplay = rawValue ? colConfig?.trueLabel || "Yes" : colConfig?.falseLabel || "No";
                                        }
                                    }

                                    // Link logic
                                    if (colConfig?.linkTemplate) {
                                        let isClickable = true;
                                        if (colConfig.linkCondition) {
                                            // linkCondition format: "field:value;;field:value" (ALL rules must match)
                                            // Multiple allowed values per field: "field:val1;val2"
                                            isClickable = colConfig.linkCondition.split(';;').every((rule: string) => {
                                                const [statusFieldName, requiredValue] = rule.split(':');
                                                if(!statusFieldName || !requiredValue) return true;
                                                const actualValue = String(rowData[statusFieldName?.trim()] || "").toLowerCase();                            
                                                const allowedValues = requiredValue.split(';').map((v: string) => v.trim().toLowerCase());
                                                return allowedValues.includes(actualValue);
                                            });
                                        }

                                        // Special pseudo-URL: #rowclick fires the onRowClick output instead of navigating to a URL.
                                        // Use this to make a column look like a link and trigger Canvas OnChange navigation.
                                        // FieldConfigurations: myColumn=linkTemplate:#rowclick|label:Open
                                        if (colConfig.linkTemplate.trim().toLowerCase() === '#rowclick') {
                                            const label = colConfig.label || formattedDisplay || 'Open';
                                            if (!isClickable) {
                                                return (
                                                    <span style={{ color: '#a1a1a1', fontWeight: 600, cursor: 'help' }} title="Not available">{label}</span>
                                                );
                                            }
                                            return (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); this.onRowClickHandler({ data: rowData }); }}
                                                    style={{ background: 'none', border: 'none', padding: 0, color: '#0078d4', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        }

                                        const baseUrl = context.parameters.apiRequestUrl?.raw
                                            ? this.extractBaseUrl(context.parameters.apiRequestUrl.raw)
                                            : "";



                                        let finalUrl = colConfig.linkTemplate;

                                        // Replace {baseurl} placeholder (case-insensitive) with the extracted base URL
                                        if (baseUrl) finalUrl = finalUrl.replace(/{baseurl}/gi, baseUrl);

                                        // Replace any remaining {fieldName} or {fieldName:fmt} tokens.
                                        // {fieldName}     → raw value (URL-encoded)
                                        // {fieldName:fmt} → display-formatted value (same as what appears in the cell)
                                        finalUrl = finalUrl.replace(/\{([^}]+)\}/g, (match: string, token: string) => {
                                            const [fieldName, modifier] = token.trim().split(':');
                                            const val = rowData[fieldName.trim()];
                                            if (val === undefined) return match;
                                            if (modifier?.trim().toLowerCase() === 'fmt') {
                                                // Apply the same display formatting as the body renderer for this field
                                                const fCfg = fieldConfigs[fieldName.trim()];
                                                const fCol = columns.find(c => c.name === fieldName.trim());
                                                if (fCfg?.currency || fCol?.dataType === 'Currency') {
                                                    return encodeURIComponent(this.formatCurrency(val, fCfg?.currency || 'USD'));
                                                } else if (fCfg?.decimalPlaces !== undefined) {
                                                    return encodeURIComponent(this.formatDecimal(val, parseInt(fCfg.decimalPlaces)));
                                                } else if (fCfg?.dateFormat || fCfg?.type === 'date' || val instanceof Date || (fCol?.dataType.includes('Date'))) {
                                                    const dateVal = val instanceof Date ? val : new Date(String(val));
                                                    if (!isNaN(dateVal.getTime())) {
                                                        return encodeURIComponent(formatDate(dateVal, fCfg?.dateFormat || 'MM/dd/yyyy', context) ?? String(val));
                                                    }
                                                }
                                                return encodeURIComponent(String(val));
                                            }
                                            return encodeURIComponent(String(val));
                                        });

                                        if (finalUrl && !finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl;
                                        const label = colConfig.label || formattedDisplay || "View Link";

                                        if (!isClickable) {
                                            return (
                                                <span className="p-column-title" style={{ color: '#a1a1a1', fontWeight: 600, cursor: 'help', display: 'inline-block' }} title="Not available">
                                                    {label}
                                                </span>
                                            );
                                        }

                                        return (
                                            <a href={finalUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#0078d4', textDecoration: 'none' }}>
                                                {label}
                                            </a>
                                        );
                                    }
                                    
                                    return formattedDisplay;
                                }}
                            />
                        );
                    })}
                </DataTable>
            </div>
        );
    }
}

export default DataGrid;