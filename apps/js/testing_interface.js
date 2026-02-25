// Internal state.
var CURRENT_INPUT_GRID = new Grid(3, 3);
var CURRENT_OUTPUT_GRID = new Grid(3, 3);
var TEST_PAIRS = new Array();
var TRAIN_PAIRS = new Array();
var CURRENT_TEST_PAIR_INDEX = 0;
var COPY_PASTE_DATA = new Array();

// Task browser state.
var TASK_INDEX = {}; // { my_tasks: [...], evaluation: [...], training: [...] }
var TASK_INDEX_LOADED = false;

// Cosmetic.
var EDITION_GRID_HEIGHT = 350;
var EDITION_GRID_WIDTH = 350;
var MAX_CELL_SIZE = 50;

// Preview grid sizing.
var PREVIEW_GRID_MAX = 280;
var TEST_INPUT_MAX = 350;
var TEST_OUTPUT_MAX = 280;

// Fixed square size for test grids (both input and output fill this area).
// This will be dynamically updated by syncTestGridHeight().
var TEST_GRID_FIXED_SIZE = 300;

// ─── Task Browser Functions ──────────────────────────────────

function loadTaskIndex() {
  if (TASK_INDEX_LOADED) {
    renderFileList();
    return;
  }
  // Use the inline data from js/task_index_data.js (works with file:// protocol)
  if (typeof TASK_INDEX_DATA !== "undefined") {
    TASK_INDEX = TASK_INDEX_DATA;
    TASK_INDEX_LOADED = true;
    renderFileList();
  } else {
    // Fallback: try fetching the JSON file (requires a server)
    $.getJSON("task_index.json", function (data) {
      TASK_INDEX = data;
      TASK_INDEX_LOADED = true;
      renderFileList();
    }).fail(function () {
      errorMsg(
        "Could not load task index. Make sure task_index_data.js is included.",
      );
    });
  }
}

function openTaskBrowser() {
  $("#modal_bg").show();
  loadTaskIndex();
}

function renderFileList() {
  // No-op: task card browser handles rendering via inline script
}

function handleTaskJSON(json, folder, filename) {
  try {
    var train = json["train"];
    var test = json["test"];
    if (!train || !test) {
      errorMsg("Bad file format: missing train/test");
      return;
    }
    loadJSONTask(train, test);
    var allFiles = TASK_INDEX[folder] || [];
    var idx = allFiles.indexOf(filename);
    display_task_name(filename, idx >= 0 ? idx : null, allFiles.length);
  } catch (e) {
    errorMsg("Bad file format");
  }
}

function loadTaskByPath(folder, filename) {
  var url = "../data/" + folder + "/" + filename;

  // Try $.getJSON first (works on local servers)
  $.getJSON(url, function (json) {
    handleTaskJSON(json, folder, filename);
  }).fail(function () {
    // Fallback: try fetch() API
    if (typeof fetch === "function") {
      fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (json) {
          handleTaskJSON(json, folder, filename);
        })
        .catch(function () {
          errorMsg(
            "Cannot load task files. Please serve via a local server: python3 -m http.server",
          );
        });
    } else {
      errorMsg(
        "Cannot load task files. Please serve via a local server: python3 -m http.server",
      );
    }
  });
}

function resetTask() {
  CURRENT_INPUT_GRID = new Grid(3, 3);
  TEST_PAIRS = new Array();
  TRAIN_PAIRS = new Array();
  CURRENT_TEST_PAIR_INDEX = 0;
  $("#task_preview").html("");
  resetOutputGrid();
}

function isMediumScreen() {
  // Returns true for the 900px–1420px range where the test panel is
  // tight and grids need container-aware sizing to avoid clipping.
  var vw = window.innerWidth;
  return vw >= 900 && vw <= 1420;
}

function refreshEditionGrid(jqGrid, dataGrid, targetHeight) {
  fillJqGridWithData(jqGrid, dataGrid);
  setUpEditionGridListeners(jqGrid);

  if (isSmallScreen()) {
    // On small screens: use scrollable sizing with half-width (same as examples).
    var containerWidth = getAvailableWidth();
    var halfWidth = Math.max(20, Math.floor((containerWidth - 30) / 2));
    fitCellsToScrollableContainer(
      jqGrid,
      dataGrid.height,
      dataGrid.width,
      halfWidth,
    );
    jqGrid.css("display", "inline-block");
    $("#output_grid").css("display", "inline-block");
  } else if (targetHeight && targetHeight > 0) {
    // Size cells so the grid fits within targetHeight (height) and
    // TEST_GRID_FIXED_SIZE (width), keeping tight-fit on the grid itself.
    var cellFromHeight = Math.floor((targetHeight - 1) / dataGrid.height);
    var cellFromWidth = Math.floor((TEST_GRID_FIXED_SIZE - 1) / dataGrid.width);
    var cellSize = Math.max(2, Math.min(cellFromHeight, cellFromWidth));
    jqGrid.find(".cell").css("height", cellSize + "px");
    jqGrid.find(".cell").css("width", cellSize + "px");
    jqGrid.css("width", cellSize * dataGrid.width + 1 + "px");
    jqGrid.css("height", cellSize * dataGrid.height + 1 + "px");
  } else {
    fitCellsToFixedContainer(
      jqGrid,
      dataGrid.height,
      dataGrid.width,
      TEST_GRID_FIXED_SIZE,
    );
  }
  initializeSelectable();
  // Update output dims label
  $("#test_output_dims").text(
    "(" + dataGrid.height + "x" + dataGrid.width + ")",
  );
}

function syncFromEditionGridToDataGrid() {
  copyJqGridToDataGrid($("#output_grid .edition_grid"), CURRENT_OUTPUT_GRID);
}

function getTestInputGridHeight() {
  var h = $("#evaluation_input").outerHeight();
  return h && h > 0 ? h : 0;
}

function syncFromDataGridToEditionGrid() {
  refreshEditionGrid(
    $("#output_grid .edition_grid"),
    CURRENT_OUTPUT_GRID,
    getTestInputGridHeight(),
  );
}

function getSelectedSymbol() {
  selected = $("#symbol_picker .selected-symbol-preview")[0];
  return $(selected).attr("symbol");
}

function setUpEditionGridListeners(jqGrid) {
  jqGrid.find(".cell").click(function (event) {
    cell = $(event.target);
    symbol = getSelectedSymbol();

    mode = $("input[name=tool_switching]:checked").val();
    if (mode == "floodfill") {
      // If floodfill: fill all connected cells.
      syncFromEditionGridToDataGrid();
      grid = CURRENT_OUTPUT_GRID.grid;
      floodfillFromLocation(grid, cell.attr("x"), cell.attr("y"), symbol);
      syncFromDataGridToEditionGrid();
    } else if (mode == "edit") {
      // Else: fill just this cell.
      setCellSymbol(cell, symbol);
    }
  });
}

function resizeOutputGrid() {
  size = $("#output_grid_size").val();
  size = parseSizeTuple(size);
  if (!size) return;
  height = size[0];
  width = size[1];

  jqGrid = $("#output_grid .edition_grid");
  syncFromEditionGridToDataGrid();
  dataGrid = JSON.parse(JSON.stringify(CURRENT_OUTPUT_GRID.grid));
  CURRENT_OUTPUT_GRID = new Grid(height, width, dataGrid);
  refreshEditionGrid(jqGrid, CURRENT_OUTPUT_GRID, getTestInputGridHeight());
}

function resetOutputGrid() {
  syncFromEditionGridToDataGrid();
  CURRENT_OUTPUT_GRID = new Grid(3, 3);
  syncFromDataGridToEditionGrid();
  $("#output_grid_size").val("3x3");
  resizeOutputGrid();
}

function copyFromInput() {
  syncFromEditionGridToDataGrid();
  CURRENT_OUTPUT_GRID = convertSerializedGridToGridObject(
    CURRENT_INPUT_GRID.grid,
  );
  syncFromDataGridToEditionGrid();
  $("#output_grid_size").val(
    CURRENT_OUTPUT_GRID.height + "x" + CURRENT_OUTPUT_GRID.width,
  );
}

function isSmallScreen() {
  // Returns true when the viewport is narrow enough that we should use
  // scrollable grid sizing (minimum cell size) instead of shrink-to-fit.
  return window.innerWidth <= 768;
}

function getAvailableWidth() {
  // Returns a reliable container width for grid sizing on small screens.
  // Tries #test_grids_container first, falls back to window width.
  var w = $("#test_grids_container").width();
  if (!w || w <= 0) {
    w = window.innerWidth - 32; // 16px padding each side
  }
  return Math.max(40, w);
}

function fillPairPreview(pairId, inputGrid, outputGrid) {
  var pairSlot = $("#pair_preview_" + pairId);
  if (!pairSlot.length) {
    // Build the new card structure
    var exNum = pairId + 1;

    var html =
      '<div id="pair_preview_' +
      pairId +
      '" class="pair_preview" index="' +
      pairId +
      '">';

    // Grids row with arrow
    html += '<div class="pair_grids_row">';

    // Input side
    html += '<div class="input_preview">';
    html += '<div class="pair_grid_label">';
    html += "<span>Ex." + exNum + " Input</span>";
    html +=
      '<span class="pair_grid_dims">(' +
      inputGrid.height +
      "x" +
      inputGrid.width +
      ")</span>";
    html += "</div>";
    html += '<div class="input_grid_container grid_display"></div>';
    html += "</div>";

    // Arrow
    html += '<div class="pair_arrow">→</div>';

    // Output side
    html += '<div class="output_preview">';
    html += '<div class="pair_grid_label">';
    html += "<span>Ex." + exNum + " Output</span>";
    html +=
      '<span class="pair_grid_dims">(' +
      outputGrid.height +
      "x" +
      outputGrid.width +
      ")</span>";
    html += "</div>";
    html += '<div class="output_grid_container grid_display"></div>';
    html += "</div>";

    html += "</div>"; // pair_grids_row
    html += "</div>"; // pair_preview

    pairSlot = $(html);
    pairSlot.appendTo("#task_preview");
  }

  var jqInputGrid = pairSlot.find(".input_grid_container");
  var jqOutputGrid = pairSlot.find(".output_grid_container");

  fillJqGridWithData(jqInputGrid, inputGrid);
  fillJqGridWithData(jqOutputGrid, outputGrid);

  if (isSmallScreen()) {
    // On small screens: use scrollable sizing with minimum cell size.
    // The pair_grids_row has overflow-x:auto so the whole row scrolls.
    // We use half the pair card width as the target for each grid,
    // but fitCellsToScrollableContainer will enforce a minimum cell size
    // so the grid may be wider than the container — that's the point.
    var pairWidth = pairSlot.width();
    var halfWidth = Math.max(20, Math.floor((pairWidth - 30) / 2)); // 30 = arrow + padding
    fitCellsToScrollableContainer(
      jqInputGrid,
      inputGrid.height,
      inputGrid.width,
      halfWidth,
    );
    fitCellsToScrollableContainer(
      jqOutputGrid,
      outputGrid.height,
      outputGrid.width,
      halfWidth,
    );
  } else {
    // On larger screens: fit grids to their parent container width.
    var inputSideWidth = pairSlot.find(".input_preview").width();
    var outputSideWidth = pairSlot.find(".output_preview").width();
    var inputGridSize = Math.max(20, inputSideWidth);
    var outputGridSize = Math.max(20, outputSideWidth);

    fitCellsToFixedContainer(
      jqInputGrid,
      inputGrid.height,
      inputGrid.width,
      inputGridSize,
    );
    fitCellsToFixedContainer(
      jqOutputGrid,
      outputGrid.height,
      outputGrid.width,
      outputGridSize,
    );
  }
}

function isTestGridsStacked() {
  // Test grids now always stay side-by-side (same as example grids).
  // They scroll horizontally if they overflow, never stack vertically.
  return false;
}

function syncTestGridHeight() {
  var pairPreview = $("#pair_preview_0");
  if (!pairPreview.length) return;

  var pairHeight = pairPreview.outerHeight();
  if (pairHeight <= 0) return;

  // Clear any previously set explicit heights so flex layout reflows naturally
  $("#test_input_wrapper").css("height", "");
  $("#test_output_wrapper").css("height", "");

  if (isSmallScreen()) {
    // ── Small screen: side-by-side with scrollable sizing ──
    // Mirrors the fillPairPreview() approach for examples:
    // each grid targets half the container width, with a minimum
    // cell size enforced so grids stay visible and the row scrolls.
    $("#test_grids_container").css("height", "auto");

    var containerWidth = getAvailableWidth();
    // arrow + padding ≈ 30px, split remaining between input & output
    var halfWidth = Math.max(20, Math.floor((containerWidth - 30) / 2));
    TEST_GRID_FIXED_SIZE = halfWidth;

    // Render test input grid with scrollable sizing (same as example grids).
    if (CURRENT_INPUT_GRID && CURRENT_INPUT_GRID.height > 0) {
      var jqTestInput = $("#evaluation_input");
      fillJqGridWithData(jqTestInput, CURRENT_INPUT_GRID);
      fitCellsToScrollableContainer(
        jqTestInput,
        CURRENT_INPUT_GRID.height,
        CURRENT_INPUT_GRID.width,
        halfWidth,
      );
      jqTestInput.css("display", "inline-block");
      $("#test_input_dims").text(
        "(" + CURRENT_INPUT_GRID.height + "x" + CURRENT_INPUT_GRID.width + ")",
      );
    }

    // Render test output grid with scrollable sizing (same as example grids).
    if (CURRENT_OUTPUT_GRID && CURRENT_OUTPUT_GRID.height > 0) {
      var jqEditionGrid = $("#output_grid .edition_grid");
      fillJqGridWithData(jqEditionGrid, CURRENT_OUTPUT_GRID);
      setUpEditionGridListeners(jqEditionGrid);
      fitCellsToScrollableContainer(
        jqEditionGrid,
        CURRENT_OUTPUT_GRID.height,
        CURRENT_OUTPUT_GRID.width,
        halfWidth,
      );
      jqEditionGrid.css("display", "inline-block");
      $("#output_grid").css("display", "inline-block");
      initializeSelectable();
      $("#test_output_dims").text(
        "(" +
          CURRENT_OUTPUT_GRID.height +
          "x" +
          CURRENT_OUTPUT_GRID.width +
          ")",
      );
    }
  } else {
    // ── Side-by-side (row) layout for larger screens ───────
    // Set #test_grids_container to match the first example pair height
    $("#test_grids_container").css("height", pairHeight + "px");

    var vw = window.innerWidth;
    var gridSize;

    if (vw >= 900 && vw <= 1420) {
      // ── Medium screens (900px–1420px, incl. 125% zoom) ──
      // The test panel is tight. Measure the container's real content
      // width (jQuery .width() excludes padding), subtract the arrow
      // separator, and split the remaining space evenly between the
      // two grids. This guarantees Input + arrow + Output all fit
      // without clipping the labels or grid edges.
      var containerContentWidth = $("#test_grids_container").width() || 0;
      var arrowEl = document.getElementById("test_arrow");
      var arrowWidth = arrowEl ? arrowEl.offsetWidth : 30;
      var availableForGrids = containerContentWidth - arrowWidth - 8; // 8px safety
      gridSize = Math.max(20, Math.floor(availableForGrids / 2));
    } else {
      // ── Large screens (> 1420px) ──
      // Plenty of room — use wrapper widths directly.
      var inputWrapperWidth = $("#test_input_wrapper").width();
      var outputWrapperWidth = $("#test_output_wrapper").width();
      var inputGridSize = Math.max(20, inputWrapperWidth);
      var outputGridSize = Math.max(20, outputWrapperWidth);
      gridSize = Math.min(inputGridSize, outputGridSize);
    }

    TEST_GRID_FIXED_SIZE = gridSize;

    // 1. Render test input grid first.
    if (CURRENT_INPUT_GRID && CURRENT_INPUT_GRID.height > 0) {
      fillTestInput(CURRENT_INPUT_GRID);
    }

    // 2. Read the input wrapper's actual rendered height (label + grid).
    var inputWrapperHeight = $("#test_input_wrapper").outerHeight();

    // 3. Render test output grid, constraining cells to fit within
    //    the same height as the input grid.
    var inputGridPixelHeight = $("#evaluation_input").outerHeight();
    if (CURRENT_OUTPUT_GRID && CURRENT_OUTPUT_GRID.height > 0) {
      refreshEditionGrid(
        $("#output_grid .edition_grid"),
        CURRENT_OUTPUT_GRID,
        inputGridPixelHeight,
      );
    }

    // 4. Force output wrapper height to match input wrapper height exactly.
    if (inputWrapperHeight && inputWrapperHeight > 0) {
      $("#test_output_wrapper").css("height", inputWrapperHeight + "px");
    }
  }
}

function resizeAllExampleGrids() {
  var small = isSmallScreen();
  for (var i = 0; i < TRAIN_PAIRS.length; i++) {
    var pair = TRAIN_PAIRS[i];
    var inputGrid = convertSerializedGridToGridObject(pair["input"]);
    var outputGrid = convertSerializedGridToGridObject(pair["output"]);

    var pairSlot = $("#pair_preview_" + i);
    if (!pairSlot.length) continue;

    var jqInputGrid = pairSlot.find(".input_grid_container");
    var jqOutputGrid = pairSlot.find(".output_grid_container");

    if (small) {
      // On small screens: scrollable sizing with minimum cell size.
      var pairWidth = pairSlot.width();
      var halfWidth = Math.max(20, Math.floor((pairWidth - 30) / 2));
      fitCellsToScrollableContainer(
        jqInputGrid,
        inputGrid.height,
        inputGrid.width,
        halfWidth,
      );
      fitCellsToScrollableContainer(
        jqOutputGrid,
        outputGrid.height,
        outputGrid.width,
        halfWidth,
      );
    } else {
      // On larger screens: fit to parent container width.
      var inputSideWidth = pairSlot.find(".input_preview").width();
      var outputSideWidth = pairSlot.find(".output_preview").width();
      var inputGridSize = Math.max(20, inputSideWidth);
      var outputGridSize = Math.max(20, outputSideWidth);

      fitCellsToFixedContainer(
        jqInputGrid,
        inputGrid.height,
        inputGrid.width,
        inputGridSize,
      );
      fitCellsToFixedContainer(
        jqOutputGrid,
        outputGrid.height,
        outputGrid.width,
        outputGridSize,
      );
    }
  }
}

function loadJSONTask(train, test) {
  resetTask();
  $("#modal_bg").hide();
  $("#error_display").hide();
  $("#info_display").hide();

  TRAIN_PAIRS = train;

  for (var i = 0; i < train.length; i++) {
    pair = train[i];
    values = pair["input"];
    input_grid = convertSerializedGridToGridObject(values);
    values = pair["output"];
    output_grid = convertSerializedGridToGridObject(values);
    fillPairPreview(i, input_grid, output_grid);
  }

  // Defer resize so the DOM layout is fully computed before measuring card widths
  setTimeout(function () {
    resizeAllExampleGrids();
    syncTestGridHeight();
  }, 0);

  for (var i = 0; i < test.length; i++) {
    pair = test[i];
    TEST_PAIRS.push(pair);
  }
  values = TEST_PAIRS[0]["input"];
  CURRENT_INPUT_GRID = convertSerializedGridToGridObject(values);
  fillTestInput(CURRENT_INPUT_GRID);
  CURRENT_TEST_PAIR_INDEX = 0;
  $("#current_test_input_id_display").html("1");
  $("#total_test_input_count_display").html(test.length);
}

function display_task_name(task_name, task_index, number_of_tasks) {
  var display_name = task_name.replace(".json", "");
  var suffix = "";
  if (task_index !== null && number_of_tasks !== null) {
    suffix = "    " + String(task_index + 1) + " of " + String(number_of_tasks);
  }
  document.getElementById("task_name").textContent =
    "Puzzle ID: " + display_name + suffix;
}

function loadTaskFromFile(e) {
  var file = e.target.files[0];
  if (!file) {
    errorMsg("No file selected");
    return;
  }
  var reader = new FileReader();
  reader.onload = function (e) {
    var contents = e.target.result;

    try {
      contents = JSON.parse(contents);
      train = contents["train"];
      test = contents["test"];
    } catch (e) {
      errorMsg("Bad file format");
      return;
    }
    loadJSONTask(train, test);
    display_task_name(file.name, null, null);
  };
  reader.readAsText(file);
}

function randomTask() {
  // Pick a random task from my_tasks
  if (!TASK_INDEX_LOADED) {
    errorMsg("Task index not loaded yet");
    return;
  }
  var files = TASK_INDEX["my_tasks"] || [];
  if (files.length === 0) {
    errorMsg("No tasks in my_tasks");
    return;
  }
  var idx = Math.floor(Math.random() * files.length);
  var filename = files[idx];
  loadTaskByPath("my_tasks", filename);
}

function prevTestInput() {
  if (CURRENT_TEST_PAIR_INDEX <= 0) {
    errorMsg("No previous test input.");
    return;
  }
  CURRENT_TEST_PAIR_INDEX -= 1;
  values = TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]["input"];
  CURRENT_INPUT_GRID = convertSerializedGridToGridObject(values);
  fillTestInput(CURRENT_INPUT_GRID);
  syncTestGridHeight();
  $("#current_test_input_id_display").html(CURRENT_TEST_PAIR_INDEX + 1);
  $("#total_test_input_count_display").html(TEST_PAIRS.length);
}

function nextTestInput() {
  if (TEST_PAIRS.length <= CURRENT_TEST_PAIR_INDEX + 1) {
    errorMsg("No next test input. Pick another file?");
    return;
  }
  CURRENT_TEST_PAIR_INDEX += 1;
  values = TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]["input"];
  CURRENT_INPUT_GRID = convertSerializedGridToGridObject(values);
  fillTestInput(CURRENT_INPUT_GRID);
  syncTestGridHeight();
  $("#current_test_input_id_display").html(CURRENT_TEST_PAIR_INDEX + 1);
  $("#total_test_input_count_display").html(TEST_PAIRS.length);
}

function submitSolution() {
  syncFromEditionGridToDataGrid();
  reference_output = TEST_PAIRS[CURRENT_TEST_PAIR_INDEX]["output"];
  submitted_output = CURRENT_OUTPUT_GRID.grid;
  if (reference_output.length != submitted_output.length) {
    errorMsg("Solution is wrong");
    return;
  }
  for (var i = 0; i < reference_output.length; i++) {
    ref_row = reference_output[i];
    if (submitted_output[i].length != ref_row.length) {
      errorMsg("Solution is wrong");
      return;
    }
    for (var j = 0; j < ref_row.length; j++) {
      if (ref_row[j] != submitted_output[i][j]) {
        errorMsg("Solution is wrong");
        return;
      }
    }
  }
  infoMsg("Correct solution!");
}

function fillTestInput(inputGrid) {
  jqInputGrid = $("#evaluation_input");
  fillJqGridWithData(jqInputGrid, inputGrid);

  if (isSmallScreen()) {
    // On small screens use scrollable sizing so cells stay ≥ 8px.
    // Use half the container width (same as example grids in fillPairPreview)
    // so input and output sit side-by-side within the scrollable row.
    var containerWidth = getAvailableWidth();
    var halfWidth = Math.max(20, Math.floor((containerWidth - 30) / 2));
    fitCellsToScrollableContainer(
      jqInputGrid,
      inputGrid.height,
      inputGrid.width,
      halfWidth,
    );
    jqInputGrid.css("display", "inline-block");
  } else {
    fitCellsToFixedContainer(
      jqInputGrid,
      inputGrid.height,
      inputGrid.width,
      TEST_GRID_FIXED_SIZE,
    );
  }

  // Update the test input dimensions label
  $("#test_input_dims").text(
    "(" + inputGrid.height + "x" + inputGrid.width + ")",
  );
}

function copyToOutput() {
  syncFromEditionGridToDataGrid();
  CURRENT_OUTPUT_GRID = convertSerializedGridToGridObject(
    CURRENT_INPUT_GRID.grid,
  );
  syncFromDataGridToEditionGrid();
  $("#output_grid_size").val(
    CURRENT_OUTPUT_GRID.height + "x" + CURRENT_OUTPUT_GRID.width,
  );
}

function initializeSelectable() {
  try {
    $(".selectable_grid").selectable("destroy");
  } catch (e) {}
  toolMode = $("input[name=tool_switching]:checked").val();
  if (toolMode == "select") {
    infoMsg(
      "Select some cells and click on a color to fill in, or press C to copy",
    );
    $(".selectable_grid").selectable({
      autoRefresh: false,
      filter: "> .row > .cell",
      start: function (event, ui) {
        $(".ui-selected").each(function (i, e) {
          $(e).removeClass("ui-selected");
        });
      },
    });
  }
}

function updateActiveToolStyle() {
  // Remove active_tool from all tool buttons
  $(".tool_btn").removeClass("active_tool");
  // Add to the one whose radio is checked
  $("input[name=tool_switching]:checked")
    .closest(".tool_btn")
    .addClass("active_tool");
}

// Initial event binding.

$(document).ready(function () {
  // Symbol picker click
  $("#symbol_picker")
    .find(".symbol_preview")
    .click(function (event) {
      symbol_preview = $(event.target);
      $("#symbol_picker")
        .find(".symbol_preview")
        .each(function (i, preview) {
          $(preview).removeClass("selected-symbol-preview");
        });
      symbol_preview.addClass("selected-symbol-preview");

      toolMode = $("input[name=tool_switching]:checked").val();
      if (toolMode == "select") {
        $(".edition_grid")
          .find(".ui-selected")
          .each(function (i, cell) {
            symbol = getSelectedSymbol();
            setCellSymbol($(cell), symbol);
          });
      }
    });

  // Edition grid listeners
  $(".edition_grid").each(function (i, jqGrid) {
    setUpEditionGridListeners($(jqGrid));
  });

  // Load task from file (all .load_task inputs — kept as fallback)
  $(document).on("change", ".load_task", function (event) {
    loadTaskFromFile(event);
  });

  $(document).on("click", ".load_task", function (event) {
    event.target.value = "";
  });

  // ── Load the task index on page ready ────────────────────
  loadTaskIndex();

  // Tool switching
  $("input[type=radio][name=tool_switching]").change(function () {
    initializeSelectable();
    updateActiveToolStyle();
  });

  // Also bind click on the tool_btn labels to ensure radio changes propagate
  $(".tool_btn").on("click", function () {
    // Small delay to let radio change propagate
    setTimeout(function () {
      updateActiveToolStyle();
      initializeSelectable();
    }, 10);
  });

  // Resize on Enter key in the size field
  $("input[type=text][name=size]").on("keydown", function (event) {
    if (event.keyCode == 13) {
      resizeOutputGrid();
    }
  });

  // Copy and paste keybindings
  $("body").keydown(function (event) {
    // Copy: Press C
    if (event.which == 67) {
      selected = $(".ui-selected");
      if (selected.length == 0) {
        return;
      }

      COPY_PASTE_DATA = [];
      for (var i = 0; i < selected.length; i++) {
        x = parseInt($(selected[i]).attr("x"));
        y = parseInt($(selected[i]).attr("y"));
        symbol = parseInt($(selected[i]).attr("symbol"));
        COPY_PASTE_DATA.push([x, y, symbol]);
      }
      infoMsg(
        "Cells copied! Select a target cell and press V to paste at location.",
      );
    }

    // Paste: Press V
    if (event.which == 86) {
      if (COPY_PASTE_DATA.length == 0) {
        errorMsg("No data to paste.");
        return;
      }
      selected = $(".edition_grid").find(".ui-selected");
      if (selected.length == 0) {
        errorMsg("Select a target cell on the output grid.");
        return;
      }

      jqGrid = $(selected.parent().parent()[0]);

      if (selected.length == 1) {
        targetx = parseInt(selected.attr("x"));
        targety = parseInt(selected.attr("y"));

        xs = new Array();
        ys = new Array();
        symbols = new Array();

        for (var i = 0; i < COPY_PASTE_DATA.length; i++) {
          xs.push(COPY_PASTE_DATA[i][0]);
          ys.push(COPY_PASTE_DATA[i][1]);
          symbols.push(COPY_PASTE_DATA[i][2]);
        }

        minx = Math.min(...xs);
        miny = Math.min(...ys);
        for (var i = 0; i < xs.length; i++) {
          x = xs[i];
          y = ys[i];
          symbol = symbols[i];
          newx = x - minx + targetx;
          newy = y - miny + targety;
          res = jqGrid.find('[x="' + newx + '"][y="' + newy + '"] ');
          if (res.length == 1) {
            cell = $(res[0]);
            setCellSymbol(cell, symbol);
          }
        }
      } else {
        errorMsg(
          "Can only paste at a specific location; only select *one* cell as paste destination.",
        );
      }
    }
  });

  // Initialize active tool style on load
  updateActiveToolStyle();

  // Re-fit example grids and sync test grid height on window resize
  var resizeTimer;
  $(window).on("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizeAllExampleGrids();
      syncTestGridHeight();
    }, 150);
  });
});
