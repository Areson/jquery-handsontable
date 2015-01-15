/**
 * Handsontable UndoRedo class
 */
(function(Handsontable){
  var ActionQueue = function() {
    var QueueObject = function() {
      var self = this;
      this.queue = [[], [], []];
      this.count = 0;

      this.add = function(item, priority) {
        self.queue[priority].push(item);
        self.count++;
      };

      return this;
    };

    var self = this; 
    var currentQueueObject = new QueueObject();   
    var list = [currentQueueObject];
    
    this.count = 0;

    this.newQueue = function() {
      if(currentQueueObject === null || currentQueueObject.count > 0) {
        currentQueueObject = new QueueObject();
        list.push(currentQueueObject);
      }
    };

    this.add = function(item, priority) {
      currentQueueObject.add(item, priority);
      self.count++;
    };

    this.clear = function() {
      currentQueueObject = new QueueObject;
      list = [currentQueueObject];
      self.count = 0;
    };

    this.getActions = function() {
      var actions = [];

      for(var i = 0; i < list.length; i++) {
        var queue = list[i];

        for(var j = 0; queue.count > 0 && j < queue.queue.length; j++) {
          var items = queue.queue[j];

          for(var k = 0; k < items.length; k++) {
            actions.push(items[k]);
          }
        }
      }

      return actions;
    };

    return this;
  };

  Handsontable.UndoRedo = function (instance) {
    var plugin = this;
    this.instance = instance;
    this.doneActions = [];
    this.undoneActions = [];
    this.ignoreNewActions = false;
    this.collectActions = false;
    this.collectedActions = new ActionQueue();

    // Track plugins that have fired
    this.hookStack = [];
    this.removalStack = [];
    this.chainStack = [];

    this.supportedHooks = {
      "afterChange": true,
      "afterCreateRow": true,
      "beforeRemoveRow": true,
      "afterCreateCol": true,
      "beforeRemoveCol": true,
      "afterFilter": true,
      "afterColumnSort": true,
      // These don't have undo handlers, but start collection to capture user events
      "beforeChange": true,
      // This is an entry for when users manually kick off collection
      "_manualCollection": true
    };

    this.chainedHooks = {
      "beforeChange": "afterChange"
    };  

    this.beforeHookHandler = function(hook) {
      if(!plugin.ignoreNewActions && plugin.supportedHooks[hook]) {
        if(plugin.hookStack.length == 0 && plugin.chainStack.length == 0) {
          plugin.collectUndo(true);
        }
        
        plugin.hookStack.push(hook);        

        // Pop any chain stack items that match this one
        if(plugin.chainStack[plugin.chainStack.length - 1] == hook) {
          plugin.chainStack.pop();
        }

        // Perform any chaining
        if(plugin.chainedHooks[hook]) {
          plugin.chainStack.push(plugin.chainedHooks[hook]);
        }
      }
    };

    this.afterHookHandler = function(hook) {
      if(!plugin.ignoreNewActions && plugin.supportedHooks[hook] && plugin.hookStack.length > 0) {
        var hadRemoval = false;
        if(plugin.hookStack[plugin.hookStack.length - 1] == hook) {
          plugin.hookStack.pop();
          hadRemoval = true;          
        }
        else {
          plugin.removalStack.push(key);
        }

        while(plugin.removalStack.length > 0 && plugin.hookStack.length > 0 && plugin.removalStack[plugin.removalStack.length - 1] == plugin.hookStack[plugin.hookStack.length - 1]) {
          plugin.removalStack.pop();
          plugin.hookStack.pop();
          hadRemoval = true;          
        }

        if(hadRemoval) {
          plugin.collectedActions.newQueue();
        }

        if(plugin.hookStack.length == 0 && plugin.chainStack.length == 0) {
          plugin.removalStack = [];
          plugin.collectUndo(false);
        }
      }
    }

    instance.addHook("beforeHook", this.beforeHookHandler);

    instance.addHook("afterHook", this.afterHookHandler);

    // Hook into events that we can handle
    instance.addHook("afterChange", function (changes, origin) {
      if(changes){
        var action = new Handsontable.UndoRedo.ChangeAction(changes);
        plugin.done(action);
      }
    });

    instance.addHook("afterCreateRow", function (index, amount, createdAutomatically) {

      if (createdAutomatically) {
        return;
      }

      var action = new Handsontable.UndoRedo.CreateRowAction(index, amount);
      plugin.done(action);
    });

    instance.addHook("beforeRemoveRow", function (index, amount) {
      var originalData = plugin.instance.getData();
      index = ( originalData.length + index ) % originalData.length;
      var removedData = [];
      for(var i = index; i < index + amount; i++) {
            var row = Handsontable.hooks.execute(instance, 'modifyRow', i);
            removedData.push(originalData[row]);
      }
      
      var action = new Handsontable.UndoRedo.RemoveRowAction(index, removedData, instance);
      plugin.done(action);          
    });

    instance.addHook("afterCreateCol", function (index, amount, createdAutomatically) {

      if (createdAutomatically) {
        return;
      }

      var action = new Handsontable.UndoRedo.CreateColumnAction(index, amount);
      plugin.done(action);
    });

    instance.addHook("beforeRemoveCol", function (index, amount) {
      var originalData = plugin.instance.getData();
      index = ( plugin.instance.countCols() + index ) % plugin.instance.countCols();
      var removedData = [];

      for (var i = 0, len = originalData.length; i < len; i++) {
        removedData[i] = originalData[i].slice(index, index + amount);
      }

      var headers;
      if(Handsontable.helper.isArray(instance.getSettings().colHeaders)){
        headers = instance.getSettings().colHeaders.slice(index, index + removedData.length);
      }

      var action = new Handsontable.UndoRedo.RemoveColumnAction(index, removedData, headers);
      plugin.done(action);
    });

    instance.addHook('afterFilter', function(currentFilterColumns, previousFilterColumns) {
      var action = new Handsontable.UndoRedo.RevertFilterAction(currentFilterColumns, previousFilterColumns);
      plugin.done(action);
    });

    instance.addHook('afterColumnSort', function(currentSortColumns, previousSortColumns) {
      var action = new Handsontable.UndoRedo.RevertSortAction(currentSortColumns, previousSortColumns);
      plugin.done(action);
    });
  };

  Handsontable.UndoRedo.LOW = 0;
  Handsontable.UndoRedo.NORMAL = 1;
  Handsontable.UndoRedo.HIGH = 2;
  
  Handsontable.UndoRedo.prototype.collectUndo = function(enableCollection) {    
    this.collectActions = enableCollection;

    if(!this.collectActions && this.collectedActions.count > 0) {
      var actions = this.collectedActions.getActions();          
      
      if(actions.length > 1) {
        this.done(new Handsontable.UndoRedo.CollectionAction(actions));
      }
      else {
        this.done(actions[0]);
      }
      
      this.collectedActions.clear();
    }
  };

  Handsontable.UndoRedo.prototype.done = function (action, priority) {
    if (!this.ignoreNewActions) {
      if(!this.collectActions) {        
        this.doneActions.push(action);
        this.undoneActions.length = 0;
      }
      else {
        priority = (priority === null || priority === undefined ? Handsontable.UndoRedo.NORMAL : priority);
        this.collectedActions.add(action, priority);        
      }

      Handsontable.hooks.run(this.instance, 'undoRedoState', 'undo', this.isUndoAvailable());
      Handsontable.hooks.run(this.instance, 'undoRedoState', 'redo', this.isRedoAvailable());
    }
  };

  /**
   * Undo operation from current revision
   */
  Handsontable.UndoRedo.prototype.undo = function () {
    if (this.isUndoAvailable()) {
      var action = this.doneActions.pop();

      this.ignoreNewActions = true;
      var that = this;

      Handsontable.hooks.run(this.instance, 'undoRedoState', 'undo', this.isUndoAvailable());

      action.undo(this.instance, function () {
        that.ignoreNewActions = false;
        that.undoneActions.push(action);
        Handsontable.hooks.run(that.instance, 'undoRedoState', 'redo', that.isRedoAvailable());
      });
    }
  };

  /**
   * Redo operation from current revision
   */
  Handsontable.UndoRedo.prototype.redo = function () {
    if (this.isRedoAvailable()) {
      var action = this.undoneActions.pop();

      this.ignoreNewActions = true;
      var that = this;

      Handsontable.hooks.run(this.instance, 'undoRedoState', 'redo', this.isRedoAvailable());

      action.redo(this.instance, function () {
        that.ignoreNewActions = false;
        that.doneActions.push(action);
        Handsontable.hooks.run(that.instance, 'undoRedoState', 'undo', that.isUndoAvailable());
      });
    }
  };

  /**
   * Returns true if undo point is available
   * @return {Boolean}
   */
  Handsontable.UndoRedo.prototype.isUndoAvailable = function () {
    return this.doneActions.length > 0;
  };

  /**
   * Returns true if redo point is available
   * @return {Boolean}
   */
  Handsontable.UndoRedo.prototype.isRedoAvailable = function () {
    return this.undoneActions.length > 0;
  };

  /**
   * Clears undo history
   */
  Handsontable.UndoRedo.prototype.clear = function () {
    this.doneActions.length = 0;
    this.undoneActions.length = 0;
    this.hookStack.length = 0;
    this.removalStack.length = 0;
    this.chainStack.length = 0;
    this.collectedActions.clear();

    Handsontable.hooks.run(this.instance, 'undoRedoState', 'undo', false);
    Handsontable.hooks.run(this.instance, 'undoRedoState', 'redo', false);
  };

  Handsontable.UndoRedo.Action = function () {
  };
  Handsontable.UndoRedo.Action.prototype.undo = function () {
  };
  Handsontable.UndoRedo.Action.prototype.redo = function () {
  };

  Handsontable.UndoRedo.ChangeAction = function (changes) {
    this.changes = changes;
  };
  Handsontable.helper.inherit(Handsontable.UndoRedo.ChangeAction, Handsontable.UndoRedo.Action);
  Handsontable.UndoRedo.ChangeAction.prototype.undo = function (instance, undoneCallback) {
    var data = Handsontable.helper.deepClone(this.changes),
        emptyRowsAtTheEnd = instance.countEmptyRows(true),
        emptyColsAtTheEnd = instance.countEmptyCols(true);

    for (var i = 0, len = data.length; i < len; i++) {
      data[i].splice(3, 1);
    }

    var firedCount = 0;    
    var _checkForCompletion = function() {
      if(++firedCount === 2) {        
        undoneCallback();
      }
    };

    instance.addHookOnce('afterChange', _checkForCompletion);

    instance.setDataAtRowProp(data, null, null, 'undo');

    for (var i = 0, len = data.length; i < len; i++) {
     if(instance.getSettings().minSpareRows &&
      data[i][0] + 1 + instance.getSettings().minSpareRows === instance.countRows()
      && emptyRowsAtTheEnd == instance.getSettings().minSpareRows) {
        instance.alter('remove_row', parseInt(data[i][0]+1,10), instance.getSettings().minSpareRows);        
      }

      if (instance.getSettings().minSpareCols &&
      data[i][1] + 1 + instance.getSettings().minSpareCols === instance.countCols()
      && emptyColsAtTheEnd == instance.getSettings().minSpareCols) {
        instance.alter('remove_col', parseInt(data[i][1]+1,10), instance.getSettings().minSpareCols);      
      }
    }

    _checkForCompletion();
  };
  Handsontable.UndoRedo.ChangeAction.prototype.redo = function (instance, onFinishCallback) {
    var data = Handsontable.helper.deepClone(this.changes);

    for (var i = 0, len = data.length; i < len; i++) {
      data[i].splice(2, 1);
    }

    instance.addHookOnce('afterChange', onFinishCallback);

    instance.setDataAtRowProp(data, null, null, 'redo');

  };

  Handsontable.UndoRedo.CreateRowAction = function (index, amount) {
    this.index = index;
    this.amount = amount;
  };
  Handsontable.helper.inherit(Handsontable.UndoRedo.CreateRowAction, Handsontable.UndoRedo.Action);
  Handsontable.UndoRedo.CreateRowAction.prototype.undo = function (instance, undoneCallback) {
    instance.addHookOnce('afterRemoveRow', undoneCallback);
    instance.alter('remove_row', this.index, this.amount);
  };
  Handsontable.UndoRedo.CreateRowAction.prototype.redo = function (instance, redoneCallback) {
    instance.addHookOnce('afterCreateRow', redoneCallback);
    instance.alter('insert_row', this.index, this.amount);
  };

  Handsontable.UndoRedo.RemoveRowAction = function (index, data, instance) {    
    this.index = index;
    this.data = data;
    
    var physicalIndexes = [];

    var allMatch = true;

    for(var i = index; i < index + data.length; i++) {
      var physicalIndex = Handsontable.hooks.execute(instance, 'modifyRow', i);
      physicalIndexes.push(physicalIndex);

      allMatch &= (physicalIndex == i);
    }

    if(!allMatch) {
      physicalIndexes.sort(function(a, b) {
          return a - b;
      });
      this.physicalIndexes = physicalIndexes;
    }
  };
  Handsontable.helper.inherit(Handsontable.UndoRedo.RemoveRowAction, Handsontable.UndoRedo.Action);
  Handsontable.UndoRedo.RemoveRowAction.prototype.undo = function (instance, undoneCallback) {    
    if(!this.physicalIndexes) {
      var spliceArgs = [this.index, 0];
      Array.prototype.push.apply(spliceArgs, this.data);

      Array.prototype.splice.apply(instance.getData(), spliceArgs);
      Handsontable.hooks.run(instance, 'afterCreateRow', this.index, this.data.length, false);
    }
    else {
      for(var i = 0; i < this.physicalIndexes.length; i++) {
        var spliceArgs = [this.physicalIndexes[i], 0];
        spliceArgs.push(this.data[i]);        
        Array.prototype.splice.apply(instance.getData(), spliceArgs);

        Handsontable.hooks.run(instance, 'afterCreateRow', this.physicalIndexes[i], 1, false);
      }
    }

    instance.addHookOnce('afterRender', undoneCallback);    
    instance.render();    
  };
  Handsontable.UndoRedo.RemoveRowAction.prototype.redo = function (instance, redoneCallback) {
    instance.addHookOnce('afterRemoveRow', redoneCallback);
    instance.alter('remove_row', this.index, this.data.length);
  };

  Handsontable.UndoRedo.CreateDataRowAction = function (index, data) {
    this.index = index;
    this.data = data;
  };
  Handsontable.helper.inherit(Handsontable.UndoRedo.CreateDataRowAction, Handsontable.UndoRedo.Action);
  Handsontable.UndoRedo.CreateDataRowAction.prototype.redo = function (instance, undoneCallback) {
    var spliceArgs = [this.index, 0];
    var spliceData = [];

    for(var i = 0; i < this.data.length; i++) {
      var spliceObject = {};
      Handsontable.helper.deepExtend(spliceObject, this.data[i])
      spliceData.push(spliceObject);
    }

    Array.prototype.push.apply(spliceArgs, spliceData);

    Array.prototype.splice.apply(instance.getData(), spliceArgs);

    instance.addHookOnce('afterRender', undoneCallback);
    Handsontable.hooks.run(instance, 'afterCreateRow', this.index, this.data.length, false);
    instance.render();    
  };
  Handsontable.UndoRedo.CreateDataRowAction.prototype.undo = function (instance, redoneCallback) {
    instance.addHookOnce('afterRemoveRow', redoneCallback);
    instance.alter('remove_row', this.index, this.data.length);
  };

  Handsontable.UndoRedo.CreateColumnAction = function (index, amount) {
    this.index = index;
    this.amount = amount;
  };
  Handsontable.helper.inherit(Handsontable.UndoRedo.CreateColumnAction, Handsontable.UndoRedo.Action);
  Handsontable.UndoRedo.CreateColumnAction.prototype.undo = function (instance, undoneCallback) {
    instance.addHookOnce('afterRemoveCol', undoneCallback);
    instance.alter('remove_col', this.index, this.amount);
  };
  Handsontable.UndoRedo.CreateColumnAction.prototype.redo = function (instance, redoneCallback) {
    instance.addHookOnce('afterCreateCol', redoneCallback);
    instance.alter('insert_col', this.index + 1, this.amount);
  };

  Handsontable.UndoRedo.RemoveColumnAction = function (index, data, headers) {
    this.index = index;
    this.data = data;
    this.amount = this.data[0].length;
    this.headers = headers;
  };
  Handsontable.helper.inherit(Handsontable.UndoRedo.RemoveColumnAction, Handsontable.UndoRedo.Action);
  Handsontable.UndoRedo.RemoveColumnAction.prototype.undo = function (instance, undoneCallback) {
    var row, spliceArgs;
    for (var i = 0, len = instance.getData().length; i < len; i++) {
      row = instance.getSourceDataAtRow(i);

      spliceArgs = [this.index, 0];
      Array.prototype.push.apply(spliceArgs, this.data[i]);

      Array.prototype.splice.apply(row, spliceArgs);

    }

    if(typeof this.headers != 'undefined'){
      spliceArgs = [this.index, 0];
      Array.prototype.push.apply(spliceArgs, this.headers);
      Array.prototype.splice.apply(instance.getSettings().colHeaders, spliceArgs);
    }

    instance.addHookOnce('afterRender', undoneCallback);
    instance.render();
  };
  Handsontable.UndoRedo.RemoveColumnAction.prototype.redo = function (instance, redoneCallback) {
    instance.addHookOnce('afterRemoveCol', redoneCallback);
    instance.alter('remove_col', this.index, this.amount);
  };

  Handsontable.UndoRedo.CollectionAction = function(collection) {
    this.collection = collection;
  };
  Handsontable.helper.inherit(Handsontable.UndoRedo.CollectionAction, Handsontable.UndoRedo.Action);
  Handsontable.UndoRedo.CollectionAction.prototype.undo = function(instance, undoneCallback) {
    var finishedLength = this.collection.length;
    var undoStepsResolved = 0;
    var collection = this.collection;
    var index = this.collection.length;

    var createCallbackStub = function() {
      return function() {
        undoStepsResolved++;

        if(undoStepsResolved == finishedLength) {
          undoneCallback();
        }
      };
    };

    var evaluateFunction = function() {
      if(index > 0) {
        var item = collection[--index];

        if(item instanceof Handsontable.UndoRedo.ChangeAction) {
          var callback = createCallbackStub();
          var loopFunction = function() {
            callback();
            evaluateFunction();
          };

          item.undo(instance, loopFunction);
        }
        else {
          item.undo(instance, createCallbackStub());
          evaluateFunction();
        }
      }
      else {
        instance.render();
      }
    };
    
    evaluateFunction();
  };
  Handsontable.UndoRedo.CollectionAction.prototype.redo = function(instance, redoneCallback) {
    var finishedLength = this.collection.length;
    var undoStepsResolved = 0;
    var collection = this.collection;
    var index = 0;
    
    var createCallbackStub = function() {
      return function() {
        undoStepsResolved++;

        if(undoStepsResolved == finishedLength) {
          redoneCallback();
        }
      };
    };

    var evaluateFunction = function() {
      if(index < collection.length) {
        var item = collection[index++];

        if(item instanceof Handsontable.UndoRedo.ChangeAction) {
          var callback = createCallbackStub();
          var loopFunction = function() {
            callback();
            evaluateFunction();
          };

          item.redo(instance, loopFunction);
        }
        else {
          item.redo(instance, createCallbackStub());
          evaluateFunction();
        }
      }
      else {
        instance.render();
      }
    };
    
    evaluateFunction();
  };

  Handsontable.UndoRedo.RevertFilterAction = function(currentFilterColumns, previousFilterColumns) {
      this.currentFilterColumns = currentFilterColumns;
      this.previousFilterColumns = previousFilterColumns;
  };
  Handsontable.helper.inherit(Handsontable.UndoRedo.RevertFilterAction, Handsontable.UndoRedo.Action);
  Handsontable.UndoRedo.RevertFilterAction.prototype.undo = function(instance, doneCallback) {      
      instance.filter(this.previousFilterColumns);
      doneCallback();
  };
  Handsontable.UndoRedo.RevertFilterAction.prototype.redo = function(instance, redoneCallback) {      
      instance.filter(this.currentFilterColumns);
      redoneCallback();
  };

  Handsontable.UndoRedo.RevertSortAction = function(currentSortColumns, previousSortColumns) {
      this.currentSortColumns = currentSortColumns;
      this.previousSortColumns = previousSortColumns;
  };
  Handsontable.helper.inherit(Handsontable.UndoRedo.RevertSortAction, Handsontable.UndoRedo.Action);
  Handsontable.UndoRedo.RevertSortAction.prototype.undo = function(instance, doneCallback) {      
      instance.sort(this.previousSortColumns);
      doneCallback();
  };
  Handsontable.UndoRedo.RevertSortAction.prototype.redo = function(instance, redoneCallback) {      
      instance.sort(this.currentSortColumns);
      redoneCallback();
  };

})(Handsontable);

(function(Handsontable){

  function init(){
    var instance = this;
    var pluginEnabled = typeof instance.getSettings().undo == 'undefined' || instance.getSettings().undo;

    if(pluginEnabled){
      if(!instance.undoRedo){
        instance.undoRedo = new Handsontable.UndoRedo(instance);
        instance.undoRedo.paused = false;

        exposeUndoRedoMethods(instance);

        instance.pauseUndo = function(pause) {
          var instance = this;
          var newState = (pause === undefined ? true : pause);

          if(!newState && instance.undoRedo.paused) {
            exposeUndoRedoMethods(instance);
            instance.addHook('beforeKeyDown', onBeforeKeyDown);
            instance.addHook('afterChange', onAfterChange);
            Handsontable.hooks.run(instance, 'undoRedoState', 'undo', this.isUndoAvailable());
            Handsontable.hooks.run(instance, 'undoRedoState', 'redo', this.isRedoAvailable());
          }
          else if(newState && !instance.undoRedo.paused) {
            removeExposedUndoRedoMethods(instance);
            instance.removeHook('beforeKeyDown', onBeforeKeyDown);
            instance.removeHook('afterChange', onAfterChange);
            Handsontable.hooks.run(instance, 'undoRedoState', 'undo', false);
            Handsontable.hooks.run(instance, 'undoRedoState', 'redo', false);
          }

          instance.undoRedo.paused = newState;
        };

        instance.addHook('beforeKeyDown', onBeforeKeyDown);
        instance.addHook('afterChange', onAfterChange);
      }    
    } else {
      if(instance.undoRedo){
        delete instance.undoRedo;

        removeExposedUndoRedoMethods(instance);

        instance.removeHook('beforeKeyDown', onBeforeKeyDown);
        instance.removeHook('afterChange', onAfterChange);
      }
    }
  }

  function onBeforeKeyDown(event){
    var instance = this;

    var ctrlDown = (event.ctrlKey || event.metaKey) && !event.altKey;

    if(ctrlDown){
      if (event.keyCode === 89 || (event.shiftKey && event.keyCode === 90)) { //CTRL + Y or CTRL + SHIFT + Z
        instance.undoRedo.redo();
        event.stopImmediatePropagation();
      }
      else if (event.keyCode === 90) { //CTRL + Z
        instance.undoRedo.undo();
        event.stopImmediatePropagation();
      }
    }
  }

  function onAfterChange(changes, source){
    var instance = this;
    if (source == 'loadData'){
      return instance.undoRedo.clear();
    }
  }

  function exposeUndoRedoMethods(instance){
    instance.undo = function(){
      return instance.undoRedo.undo();
    };

    instance.redo = function(){
      return instance.undoRedo.redo();
    };

    instance.isUndoAvailable = function(){
      return instance.undoRedo.isUndoAvailable();
    };

    instance.isRedoAvailable = function(){
      return instance.undoRedo.isRedoAvailable();
    };

    instance.clearUndo = function(){
      return instance.undoRedo.clear();
    };

    instance.collectUndo = function(enabledCollection) {
      if(enabledCollection) {
        instance.undoRedo.beforeHookHandler('_manualCollection');
      }
      else {
        instance.undoRedo.afterHookHandler('_manualCollection');
      }      
    }
  }

  function removeExposedUndoRedoMethods(instance){
    delete instance.undo;
    delete instance.redo;
    delete instance.isUndoAvailable;
    delete instance.isRedoAvailable;
    delete instance.clearUndo;
  }

  Handsontable.hooks.add('afterInit', init);
  Handsontable.hooks.add('afterUpdateSettings', init);
  Handsontable.hooks.register('undoRedoState');  

})(Handsontable);
