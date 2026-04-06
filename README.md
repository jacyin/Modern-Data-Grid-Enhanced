# Modern Data Grid

A Power Apps Component Framework (PCF) data grid for Canvas Apps with filtering, sorting, pagination, aggregates, JSON mode, row click outputs, and flexible per-column configuration.

## Features

- Optimized for Canvas Apps
- Works with either a bound dataset or raw JSON data
- Built-in search, column filtering, sorting, and pagination
- Default sorting support
- Aggregate summaries in the paginator area
- Horizontal scrolling for wide grids
- `ShrinkToFit` and `ContentHeight` support for responsive layouts
- Row click outputs for popup/detail experiences
- Flexible `FieldConfigurations` for formatting and links
- `linkTemplate` support for raw values, formatted values, and row-click actions

![modernDataGrid - Promo](https://github.com/user-attachments/assets/5e1b4db6-ed2b-4a42-bc7c-07d49cb9b159)

For issues or feedback, please use the repository Issues tab.

## Attribution

This repository is derived from the original project by GorgonUK:

- Original repository: https://github.com/GorgonUK/Modern-Data-Grid

This fork includes additional maintenance and enhancements.

## Installation

### Enable code components for Canvas Apps

1. Open [Power Platform Admin Center](https://admin.powerplatform.microsoft.com).
2. Go to **Environments**.
3. Open **Settings**.
4. Under **Product**, open **Features**.
5. Enable **Allow publishing of canvas apps with code components**.

### Import the solution

1. Download the latest solution from the [releases page](https://github.com/GorgonUK/Modern-Data-Grid/releases).
2. Open [Power Apps Maker Portal](https://make.powerapps.com).
3. Choose **Import solution** and complete the import.

### Add the component to a Canvas App

1. Open the Canvas App in edit mode.
2. Go to **Insert**.
3. Open the **Code** tab.
4. Insert **ModernDataGrid**.

## Quick start

### Dataset mode

Bind the component to a tabular source through the component's dataset input.

### JSON mode

Pass a full JSON array string into `jsonData`.

Example:

```powerfx
Set(varTimesheetsJson, JSON(colTimesheets))
```

Bind the grid's `jsonData` property to `varTimesheetsJson`.

## Properties

### Bound input properties

| Property | Type | Description |
|---|---|---|
| `IsEnabled` | Boolean | Enables or disables the grid. |
| `apiRequestUrl` | Text | Base API URL used by `linkTemplate` when `{baseurl}` is present. |
| `DisplayHeader` | Boolean | Shows or hides the header area. |
| `HeaderText` | Text | Header title. |
| `DisplaySearch` | Boolean | Shows or hides the global search box. |
| `DisplayPagination` | Boolean | Enables paginator controls. |
| `EmptyMessage` | Text | Message shown when no data is available. |
| `SelectionMode` | Text | Current supported value is typically `multiple`. |
| `AllowSorting` | Boolean | Enables column sorting. |
| `DefaultSort` | Text | Default sort expression. Examples: `weekEndingDate`, `weekEndingDate asc`, `weekEndingDate desc`, `weekEndingDate:desc`. |
| `AllowFiltering` | Boolean | Enables column filters. |
| `FieldConfigurations` | TextArea | Per-column configuration string for formatting, links, defaults, widths, and more. |
| `showAggregates` | Boolean | Displays aggregate summary values in the paginator area. |
| `aggregateConfig` | Text | JSON object describing which aggregate to apply per column. |
| `jsonData` | TextArea | JSON string for full client-side rendering in Canvas. |
| `ShrinkToFit` | Boolean | When `true`, grid height collapses to content. When `false`, grid uses allocated height with a minimum usable height. |

### Output properties

| Property | Type | Description |
|---|---|---|
| `ContentHeight` | Number | Rendered grid height in pixels. Useful for Canvas height formulas. |
| `EventName` | Text | Last event emitted by the grid. Current event: `rowClick`. |
| `SelectedRowData` | TextArea | JSON string of the clicked row. Use `ParseJSON()` in Canvas. |

## Default sorting

Use `DefaultSort` to apply a sort automatically on initial load.

Examples:

```text
weekEndingDate
weekEndingDate asc
weekEndingDate desc
weekEndingDate:desc
```

Notes:

- If only a field name is provided, ascending order is used.
- If the property changes later, the grid reapplies the new default sort and returns to page 1.

## JSON mode notes

In JSON mode, the entire data set is loaded into the grid and sorting, filtering, and paging are handled client-side.

Example with pre-sorted JSON:

```powerfx
Set(
    varTimesheetsJson,
    JSON(SortByColumns(colTimesheets, "weekEndingDate", Descending))
)
```

ISO date strings such as `2025-06-28T00:00:00` sort correctly as strings.

## FieldConfigurations

`FieldConfigurations` is a comma-separated list of column settings:

```text
Amount=currency:USD,
WeekEndingDate=dateFormat:MM/dd/yyyy,
Hours=decimalPlaces:2,
Active=trueLabel:Yes|falseLabel:No
```

### Common options

| Option | Example | Description |
|---|---|---|
| `currency` | `Amount=currency:USD` | Formats values as currency. |
| `decimalPlaces` | `Hours=decimalPlaces:2` | Formats decimals with fixed precision. |
| `dateFormat` | `WeekEndingDate=dateFormat:MM/dd/yyyy` | Formats date values. |
| `trueLabel` / `falseLabel` | `Approved=trueLabel:Approved|falseLabel:Pending` | Custom labels for boolean fields. |
| `width` | `Description=width:240px` | Sets explicit column width. |
| `type` | `Status=type:optionset` | Overrides detected type for filtering/rendering. |
| `label` | `Action=label:Open` | Custom text for link/action display. |
| `linkTemplate` | `Document=linkTemplate:https://site/doc/{id}` | Creates a clickable link. |
| `linkCondition` | `Document=linkCondition:status:active` | Makes link/action conditional. |
| `hidden` | `InternalId=hidden:true` | Hides the column from display (still available in config/logic). Use lowercase `true`. |
| `defaultFilter` | `WeekEndingDate=defaultFilter:lastmonth` | Applies an initial filter value. |
| `defaultFilterMode` | `Name=defaultFilterMode:contains` | Controls the initial filter match mode. |

### `defaultFilter` date keywords

Supported date keywords include:

```text
today
yesterday
thisweek
lastweek
thismonth
lastmonth
thisquarter
lastquarter
thisyear
lastyear
```

Explicit date values and ranges are also supported:

```text
InvoiceDate=defaultFilter:2026-01-01
InvoiceDate=defaultFilter:2026-01-01..2026-03-31
```

### `defaultFilterMode` keywords

Supported match modes for text and numeric filtering:

**Text operators:**
```text
contains          — field contains text
notcontains       — field does not contain text
startswith        — field starts with text
endswith          — field ends with text
equals            — exact match
notequals         — not equal
```

**Numeric operators:**
```text
equals            — exact numeric match
notequals         — not equal
lt                — less than
lte               — less than or equal to
gt                — greater than
gte               — greater than or equal to
between           — within a range (requires array: [min, max])
in                — value in list
```

**Date operators:**
```text
dateis            — date is exactly
dateisnot         — date is not
datebefore        — before date
dateafter         — after date
```

Examples:

```text
EmployeeId=defaultFilter:A00019|defaultFilterMode:equals
TotalAmount=defaultFilter:500|defaultFilterMode:gt
Quantity=defaultFilter:100|defaultFilterMode:lte
```

## Links and actions

### Standard link templates

`linkTemplate` supports:

- `{baseurl}`
- `{fieldName}` for raw values
- `{fieldName:fmt}` for display-formatted values

Example:

```text
Pdf=linkTemplate:{baseurl}/invoice/{invoiceNumber}/{weekEndingDate:fmt}|label:View PDF
```

### Conditional links

Example:

```text
Pdf=linkTemplate:https://contoso.com/file/{id}|label:View|linkCondition:status:approved
```

Multiple rules can be combined with `;;`, and multiple allowed values can be separated with `;`.

### Row click action links

Use `#rowclick` to render a link-like action that triggers the grid's row click output instead of opening a URL.

Example:

```text
Action=linkTemplate:#rowclick|label:Open
```

This is useful when opening a popup or loading detail data in Canvas.

## Aggregates

Set `showAggregates` to `true` and provide an `aggregateConfig` JSON object.

### Single aggregate per field

Example:

```json
{"timeWorked": "sum", "payAmount": "sum"}
```

### Multiple aggregates per field

Separate multiple aggregate types with `|`:

```json
{"totalAmount": "sum|avg|max", "quantity": "sum|count"}
```

This will display all selected aggregates for that field in the paginator. Example output:
```
totalAmount: sum=$12,345.67, avg=$1,234.57, max=$9,999.99
```

### Supported aggregate types

- `sum` — total of numeric values
- `count` — record count
- `avg` or `average` — average of numeric values
- `min` — minimum numeric value
- `max` — maximum numeric value

Aggregate values appear in the paginator area at the top of the grid, and automatically update whenever filters are applied or data changes.

### How aggregates work with filters

Aggregates are calculated from **filtered records only**. When you apply column filters or use the search box:

- The grid displays only matching rows
- Aggregates recalculate based on those matching rows
- The totals, averages, counts update in real-time to match what you see

## Responsive layout

### `ShrinkToFit`

- `true`: height collapses to content
- `false`: grid fills allocated height, with vertical and horizontal overflow as needed

### `ContentHeight`

Use the output in Canvas if you want the container or control height to follow the rendered content.

Example:

```powerfx
ModernDataGrid.ContentHeight
```

## Row click outputs and popup pattern

When a row is clicked, the grid emits:

- `EventName = "rowClick"`
- `SelectedRowData = JSON string of the clicked row`

### Important: Row-click suppression on non-click events

The grid automatically clears `EventName` and `SelectedRowData` whenever the grid refreshes due to filtering, sorting, resizing, or other non-click updates. This prevents your `OnChange` handler from accidentally triggering popup logic when filters are applied.

**Result**: Your popup will only open on actual row clicks, not on filter changes.

### Example `OnChange` formula

```powerfx
If(
    ModernDataGrid.EventName = "rowClick",
    Set(varSelectedRow, ParseJSON(ModernDataGrid.SelectedRowData));
    Set(varShowPopup, true)
)
```

### Closing popups

To close a popup when clicking outside it, place a full-screen backdrop behind the popup and set its `OnSelect` to:

```powerfx
Set(varShowPopup, false)
```

## Loading related detail data in Canvas

Example pattern after a row click:

```powerfx
If(
    ModernDataGrid.EventName = "rowClick",
    Set(varSelectedRow, ParseJSON(ModernDataGrid.SelectedRowData));
    Set(varShowPopup, true);
    Set(
        varTimesheetDetail,
        BCAPIConnector.GetEmployeeTimesheetWeeklyDetail(
            Text(varSelectedRow.employeeId),
            { weekStarting: Text(DateAdd(DateValue(Left(Text(varSelectedRow.weekEndingDate), 10)), -6, TimeUnit.Days), "yyyy-mm-dd") }
        )
    )
)
```

Adjust the response access path to match your custom connector schema, for example `.items` if the connector exposes a paged wrapper.

## Date handling in Canvas

For ISO strings like `2024-10-12T00:00:00`:

- Date part only:

```powerfx
Left(Text(yourField), 10)
```

- Convert to a real date:

```powerfx
DateValue(Left(Text(yourField), 10))
```

- Add 7 days:

```powerfx
DateAdd(DateValue(Left(Text(yourField), 10)), 7, TimeUnit.Days)
```

## Notes

- The grid supports horizontal scrolling for wide column sets.
- Pagination is rendered at the top of the grid.
- Aggregates are shown inline in the paginator area.
- In JSON mode, columns can be auto-derived from the first record when dataset columns are not defined.

## Recent changes

### v0.0.147 — Multiple aggregates per field
- Support multiple aggregate types per field using pipe separator: `"totalAmount": "sum|avg|max"`
- All aggregates display together: `sum=$12,000, avg=$1,000, max=$5,000`

### v0.0.146 — Comprehensive filter operator support
- Added all numeric operators: `lt`, `lte`, `gt`, `gte`, `between`, `in`
- All date operators: `dateis`, `dateisnot`, `datebefore`, `dateafter`
- Aggregates now respect all filter types and operators
- Aggregates recalculate when any filter is applied

### v0.0.145 — Aggregate filtering alignment
- Aggregates now use PrimeReact FilterService for match logic
- Fixed `>=` and `<=` operators in filtering
- Aggregates update correctly when filters change

### v0.0.143 — Row-click event suppression
- Non-click updates (filter/resize/sort) no longer emit row-click events
- Popups only open on actual row clicks, preventing accidental triggers

### v0.0.142 — Paginator layout fix
- Paginator controls right-align when no aggregates present
- Aggregates spread across full width when present

### v0.0.141 — Default sorting
- Added `DefaultSort` property supporting: `fieldName`, `fieldName asc`, `fieldName desc`, `fieldName:desc`

### v0.0.139 — Row-click link templates
- `#rowclick` special URL for link-style buttons that fire row click instead of navigating
- Useful for popup/detail scenarios

### v0.0.138 — Row click outputs
- `EventName` and `SelectedRowData` output properties for row click events

