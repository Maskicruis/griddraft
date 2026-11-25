'use strict';

const {randomUUID}=require('node:crypto');
const engine=require('./engine.cjs');

function assessment(graph){
  try{
    const result=engine.cpm(graph);
    return {days:result.duration,critical:result.nodes.filter(node=>node.tf===0).map(node=>node.id),issues:[]};
  }catch(error){
    return {days:null,critical:[],issues:[{code:error.code,message:error.message}]};
  }
}

function difference(before,after){
  const changes=[];
  for(const [key,kind] of [['nodes','工序'],['edges','连线']]){
    const old=new Map(before[key].map(item=>[item.id,item]));
    const next=new Map(after[key].map(item=>[item.id,item]));
    for(const item of before[key])if(!next.has(item.id))changes.push({kind:'removed',id:item.id,description:'删除'+kind+' '+item.id+' '+(item.label||item.from+' → '+item.to)});
    for(const item of after[key]){
      const previous=old.get(item.id);
      if(!previous){
        changes.push({kind:'added',id:item.id,description:'新增'+kind+' '+item.id+' '+(item.label||item.from+' → '+item.to)});
      }else if(JSON.stringify(previous)!==JSON.stringify(item)){
        const fields=key==='nodes'?['label','kind','duration','position','unit','estimated']:['from','to','label','lag'];
        const names={label:'名称',kind:'类型',duration:'工期',position:'位置',from:'起点',to:'终点',lag:'时滞',unit:'单位工程',estimated:'工期占位'};
        const details=fields.filter(field=>JSON.stringify(previous[field])!==JSON.stringify(item[field]))
          .map(field=>names[field]+' '+JSON.stringify(previous[field]??null)+' → '+JSON.stringify(item[field]??null));
        if(details.length)changes.push({kind:'modified',id:item.id,description:kind+' '+item.id+' '+details.join('，')});
      }
    }
  }
  if(before.title!==after.title)changes.unshift({kind:'modified',id:'title',description:'图名称 '+before.title+' → '+after.title});
  if(JSON.stringify(before.project)!==JSON.stringify(after.project))changes.push({kind:'modified',id:'project',description:'项目信息或工序模板已更新'});
  if(before.direction!==after.direction)changes.push({kind:'modified',id:'direction',description:'排版方向 '+before.direction+' → '+after.direction});
  return changes;
}

class GraphWorkspace{
  constructor(graph){
    this.base=engine.normalize(graph);
    this.graph=this.base;
    this.previous=[];
    this.revision=randomUUID();
    this.actions=[];
    this.context={};
  }
  sync(graph,context={}){
    const next=engine.normalize(graph);
    const changed=JSON.stringify(next)!==JSON.stringify(this.base);
    if(changed){
      this.base=next;this.graph=next;this.previous=[];this.revision=randomUUID();
    }
    if(changed||!this.proposal())this.actions=[];
    this.context={view:context.view,unit:context.unit,selection:context.selection,canUndo:context.canUndo===true,canRedo:context.canRedo===true};
    return changed;
  }
  checkpoint(){
    return {graph:this.graph,previous:this.previous.slice(),revision:this.revision,actions:this.actions.slice()};
  }
  restore(checkpoint){
    Object.assign(this,checkpoint);
  }
  commit(candidate){
    const checked=engine.normalize(candidate);
    this.previous.push(this.graph);
    if(this.previous.length>30)this.previous.shift();
    this.graph=checked;this.revision=randomUUID();
    return this.describe();
  }
  edit(operations){
    if(!Array.isArray(operations))throw Error('operations 须为操作数组。');
    const nodes=new Map(this.graph.nodes.map(node=>[node.id,node]));
    const edges=new Map(this.graph.edges.map(edge=>[edge.id,edge]));
    const expanded=operations.map(operation=>{
      if(operation?.op==='put-node'&&operation.node){
        const supplied=operation.node;
        const previous=nodes.get(supplied.id);
        const node={...previous,...supplied};
        if(!previous){
          node.kind??='task';
          node.duration??=node.kind==='milestone'?0:1;
        }
        nodes.set(node.id,node);
        return {...operation,node};
      }
      if(operation?.op==='put-edge'&&operation.edge){
        const edge={...edges.get(operation.edge.id),...operation.edge};
        edges.set(edge.id,edge);
        return {...operation,edge};
      }
      if(operation?.op==='remove-node'){
        nodes.delete(operation.id);
        for(const [id,edge] of edges)if(edge.from===operation.id||edge.to===operation.id)edges.delete(id);
      }
      if(operation?.op==='remove-edge')edges.delete(operation.id);
      return operation;
    });
    return this.commit(engine.edit(this.graph,expanded));
  }
  replace(graph){return this.commit(graph);}
  undo(){
    if(!this.previous.length)throw Error('当前草稿没有可撤销的修改。');
    this.graph=this.previous.pop();this.revision=randomUUID();
    return this.describe();
  }
  discard(){
    this.graph=this.base;this.previous=[];this.actions=[];this.revision=randomUUID();
    return this.describe();
  }
  describe(){
    return {title:this.graph.title,count:this.graph.nodes.length,links:this.graph.edges.length,
      ...(this.graph.project?{project:{name:this.graph.project.name,units:this.graph.project.units},
        estimated:this.graph.nodes.filter(node=>node.estimated).length}:{}),
      ...assessment(this.graph),draftChanges:difference(this.base,this.graph).length};
  }
  proposal(){
    const changes=difference(this.base,this.graph);
    if(!changes.length)return null;
    const before=assessment(this.base),after=assessment(this.graph);
    return {id:this.revision,before:before.days,after:after.days,changes,issues:after.issues};
  }
  preview(graph,id){
    if(id!==this.revision||!this.proposal())throw Error('草稿已变化，请使用最新草稿。');
    if(JSON.stringify(engine.normalize(graph))!==JSON.stringify(this.base))throw Error('当前网络图已变化，请基于当前图重新修改。');
    return this.graph;
  }
  apply(graph,id){
    const result=this.preview(graph,id);
    this.base=result;this.previous=[];this.actions=[];this.revision=randomUUID();
    return result;
  }
}

module.exports={GraphWorkspace,assessment};
