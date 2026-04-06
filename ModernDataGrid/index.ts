import { IInputs, IOutputs } from "./generated/ManifestTypes";
import DataSetInterfaces = ComponentFramework.PropertyHelper.DataSetApi;
import * as React from "react";
type DataSet = ComponentFramework.PropertyTypes.DataSet;
import DataGrid from "./components/DataGrid";

export class ModernDataGrid implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private container: HTMLDivElement;
    private notifyOutputChanged: () => void;
    private _contentHeight: number = 0;
    private _eventName: string = '';
    private _selectedRowData: string = '';

    private emitNonRowClickOutput(): void {
        this._eventName = '';
        this._selectedRowData = '';
        this.notifyOutputChanged();
    }

    constructor() {}

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        console.log("Modern Data Grid 1.7");
        this.container = container;
        this.notifyOutputChanged = notifyOutputChanged;
    }
    public updateView(
        context: ComponentFramework.Context<IInputs>
      ): React.ReactElement {
        return React.createElement(DataGrid, {
            context: context,
            notifyOutputChanged: () => {
                this.emitNonRowClickOutput();
            },
            onHeightChange: (h: number) => {
                this._contentHeight = h;
                this.emitNonRowClickOutput();
            },
            onRowClick: (eventName: string, rowData: string) => {
                this._eventName = eventName;
                this._selectedRowData = rowData;
                this.notifyOutputChanged();
            }
        });
    }

    public getOutputs(): IOutputs {
        return {
            ContentHeight: this._contentHeight,
            EventName: this._eventName,
            SelectedRowData: this._selectedRowData
        };
    }

    public destroy(): void {
    }
}
