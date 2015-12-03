var Firebase = require("firebase");
var ref = new Firebase("https://oh-developer-test.firebaseio.com/orders");
var S = require('string');
var moment = require('moment');
var async = require('async');
var refRes = new Firebase("https://oh-developer-test.firebaseio.com/restaurants");
var refRun = new Firebase("https://oh-developer-test.firebaseio.com/runners");

module.exports = {
	get : function(req, res, next) {
    //retrieve the code tables in parallel first
    async.parallel([
      function(cb) {
        console.log("Retrieving restaurants.");
        refRes.once('value', function(snapshot) {
          snapshot._snapName = 'restaurants';
          cb(null, snapshot);
        }, function(err) {
          throw new Error("Error retrieving restaurants");
        })
      },

      function(cb) {
        console.log("Retrieving runners.");
        refRun.once('value', function(snapshot) {
          snapshot._snapName = 'runners';
          cb(null, snapshot);
        }, function(err) {
          throw new Error("Error retrieving runners");
        })
      }
    ], function(err, results) {
      if (err) {throw err;}
      var restaurants = {};
      var runners = {};
      for (var i in results) {
        var snap = results[i];
        if (snap._snapName == 'restaurants') {
          restaurants = snap.val();
        } else {
          runners = snap.val();
        }
      }

      doGet(req, res, next, restaurants, runners);
    })

    
	}
}


function doGet(req, res, next, restaurants, runners) {
  console.log("Generating orderhood report..");
    var dateTo = req.query.dateTo? new Date(req.query.dateTo) : new Date();
    var dateFr;
    if (req.query.dateFr) {
      dateFr = new Date(req.query.dateFr);
    } else {
      dateFr = new Date();
      dateFr.setDate(dateFr.getDate() - 7);
    }

    if (dateFr.getTime() > dateTo.getTime()) {
      req.flash('error', 'Date To must be later than Date From.');
      res.redirect('/');
      return;
    }
   
    ref
    .orderByChild("log/orderTime")
    .startAt(dateFr.getTime())
    .endAt(dateTo.getTime())
    .once("value", function(snapshot) {

      var orders = getOrdersFromSnapshot(snapshot, restaurants, runners);
      console.log("Got order data",orders.length);

      doRender(req, res, orders, dateFr, dateTo);
    }, function (errorObject) {
      console.log("The read failed: " + errorObject.code);
      throw new Error("Error retrieving order data.");
    });

    
}

function doRender(req, res, orders, dateFr, dateTo) {
  var sort = req.query.sort || 'orderTime';
  var lastSort = req.query.lastSort;
  var order = 'asc';
  if (sort == lastSort && req.query.lastOrder == 'asc') {
    order = 'desc';
  } else if (!lastSort) {
    order = 'desc';
  }

  console.log("Sorting by",sort,order);

  orders.sort(getSortFunction(sort, order));

  if (req.query.exportToCsv == 'Y') {
    doExport(req, res, orders);
  } else {
    res.render('index.html', {orders: orders, lastSort: sort, lastOrder: order, dateFr: dateFr, dateTo: dateTo});  
  }
  
}

function doExport(req, res, orders) {
  res.setHeader('Content-disposition', 'attachment; filename=export_' + new Date().getTime() + '.csv');


  res.write('Order ID,Restaurant Name,Runner Name,Status,Order Amount,Tip Amount,Orderer Name,Order Date and Time\n');

  for (var i in orders) {
    var order = orders[i];
    var vals = [nvlEmpty(order._id), 
                nvlEmpty(order.restaurantName),
                nvlEmpty(order.runnerName),
                nvlEmpty(order.status),
                nvlEmpty(order.orderAmount),
                nvlEmpty(order.tipAmount),
                nvlEmpty(order.ordererName),
                nvlEmpty(convertToDateStr(order.orderTime))];
    res.write(S(vals).toCSV().s);
    res.write("\n");
  }

  res.end('');
}

function convertToDateStr(longTime) {
  if (!longTime) {
    return null;
  }

  return moment(longTime).format('MM-DD-YYYY hh:mm A');
}

function nvlEmpty(str) {
  if (!str) {
    return '';
  }

  return str;
}

function getSortFunction(sort, order) {
  return function(a, b) {

    //hardcode, why is orderAmount and tipAmount in string format?
    if (sort == "tipAmount" || sort == "orderAmount") {
      return sortNum(a, b, sort, order);
    }

    if (typeof a[sort] == "string" || typeof b[sort] == "string") {
      return sortStr(a, b, sort, order);
    } else {
      return sortNum(a, b, sort, order);
    }
  }
}

function sortNum(a, b, sort, order) {
  if (order == 'asc') {
      return a[sort] - b[sort];
    } else {
      return b[sort] - a[sort];
    }
}

function sortStr(a, b, sort, order) {
  var aVal = a[sort] || "";
  var bVal = b[sort] || "";

  if (order == 'asc') {
    return aVal.localeCompare(bVal);
  } else {
    return bVal.localeCompare(aVal);
  }
}

function getOrdersFromSnapshot(snapshot, restaurants, runners) {
  var orders = [];
  var ordersDict = snapshot.val();
  //do necessary data pre formatting if any 
  for (var i in ordersDict) {
    var order = ordersDict[i];
    order._id = i;

    //flatten for sorting
    order.orderTime = order.log.orderTime;
    order.ordererName = order.orderer.name
    order.restaurantName = getRestaurantName(order.restaurant, restaurants);
    order.runnerName = getRunnerName(order.runner, runners);
    orders.push(order);
  }

  return orders;
}

function getRestaurantName(restaurantId, restaurants) {
  if (restaurants[restaurantId]) {
    return restaurants[restaurantId].name;
  }

  return null;
}


function getRunnerName(runnerId, runners) {
  if (!runnerId || !runners[runnerId]) {
    return null;
  }

  return runners[runnerId].name;
}

