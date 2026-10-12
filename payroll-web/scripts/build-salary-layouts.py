"""Extract sanitized, reusable export layouts from the four authorized samples.

No employee values or monthly amounts are embedded in the generated web assets.
OOXML styles and print layouts are preserved directly. xlrd is needed only to
read the legacy XLS formatting when rebuilding these assets.
"""
import argparse
import collections
import json
import re
import sys
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as E

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
E.register_namespace('', NS)
q = lambda name: '{' + NS + '}' + name


def col(index):
    out = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        out = chr(65 + remainder) + out
    return out


def row_number(address):
    return int(re.search(r'\d+$', address).group())


def xml(element):
    return E.tostring(element, encoding='unicode').replace(' xmlns="' + NS + '"', '')


def legacy_parts(file, source):
    import xlrd
    book = xlrd.open_workbook(str(file), formatting_info=True)
    sheet = book.sheet_by_index(0)
    styles = E.Element(q('styleSheet'))
    numfmts = E.SubElement(styles, q('numFmts'))
    format_ids = {}
    for key, fmt in book.format_map.items():
        if key < 164:
            format_ids[key] = key
        else:
            format_ids[key] = 164 + len(numfmts)
            E.SubElement(numfmts, q('numFmt'), numFmtId=str(format_ids[key]), formatCode=fmt.format_str)
    numfmts.set('count', str(len(numfmts)))

    def color(parent, name, index):
        rgb = book.colour_map.get(index)
        if rgb:
            E.SubElement(parent, q(name), rgb='FF' + ''.join(f'{v:02X}' for v in rgb))
        else:
            E.SubElement(parent, q(name), auto='1')

    fonts = E.SubElement(styles, q('fonts'), count=str(len(book.font_list)))
    for font in book.font_list:
        node = E.SubElement(fonts, q('font'))
        # BIFF reserves font slot 4 as an unused zero-height placeholder;
        # OOXML still requires every font size to be a valid positive value.
        E.SubElement(node, q('sz'), val=str(font.height / 20 if font.height else book.font_list[0].height / 20))
        E.SubElement(node, q('name'), val=font.name)
        color(node, 'color', font.colour_index)
        if font.bold:
            E.SubElement(node, q('b'))
        if font.italic:
            E.SubElement(node, q('i'))
        if font.struck_out:
            E.SubElement(node, q('strike'))
        if font.underline_type:
            E.SubElement(node, q('u'))
    fills = E.SubElement(styles, q('fills'))
    E.SubElement(E.SubElement(fills, q('fill')), q('patternFill'), patternType='none')
    E.SubElement(E.SubElement(fills, q('fill')), q('patternFill'), patternType='gray125')
    borders = E.SubElement(styles, q('borders'))
    E.SubElement(borders, q('border'))
    xfs = E.SubElement(styles, q('cellXfs'))
    patterns = ['none', 'solid', 'mediumGray', 'darkGray', 'lightGray', 'darkHorizontal', 'darkVertical', 'darkDown', 'darkUp', 'darkGrid', 'darkTrellis', 'lightHorizontal', 'lightVertical', 'lightDown', 'lightUp', 'lightGrid', 'lightTrellis', 'gray125', 'gray0625']
    lines = ['none', 'thin', 'medium', 'dashed', 'dotted', 'thick', 'double', 'hair', 'mediumDashed', 'dashDot', 'mediumDashDot', 'dashDotDot', 'mediumDashDotDot', 'slantDashDot']
    for xf in book.xf_list:
        fill = E.SubElement(fills, q('fill'))
        pattern = E.SubElement(fill, q('patternFill'), patternType=patterns[xf.background.fill_pattern])
        color(pattern, 'fgColor', xf.background.pattern_colour_index)
        color(pattern, 'bgColor', xf.background.background_colour_index)
        border = E.SubElement(borders, q('border'))
        for edge in ['left', 'right', 'top', 'bottom']:
            style = getattr(xf.border, edge + '_line_style')
            node = E.SubElement(border, q(edge), style=lines[style])
            color(node, 'color', getattr(xf.border, edge + '_colour_index'))
        node = E.SubElement(xfs, q('xf'), numFmtId=str(format_ids.get(xf.format_key, 0)), fontId=str(xf.font_index), fillId=str(len(fills)-1), borderId=str(len(borders)-1), xfId='0', applyAlignment='1')
        a = xf.alignment
        horizontal = ['general', 'left', 'center', 'right', 'fill', 'justify', 'centerContinuous', 'distributed'][a.hor_align]
        vertical = ['top', 'center', 'bottom', 'justify', 'distributed'][a.vert_align]
        E.SubElement(node, q('alignment'), horizontal=horizontal, vertical=vertical, wrapText=str(a.text_wrapped), textRotation=str(a.rotation if a.rotation <= 180 else 0), indent=str(a.indent_level), shrinkToFit=str(a.shrink_to_fit))
    for node in [fills, borders, xfs]:
        node.set('count', str(len(node)))
    stylexfs = E.Element(q('cellStyleXfs'), count='1')
    E.SubElement(stylexfs, q('xf'), numFmtId='0', fontId='0', fillId='0', borderId='0')
    styles.insert(list(styles).index(xfs), stylexfs)
    cellstyles=E.SubElement(styles,q('cellStyles'),count='1')
    E.SubElement(cellstyles,q('cellStyle'),name='Normal',xfId='0',builtinId='0')
    root = E.Element(q('worksheet'))
    E.SubElement(root, q('dimension'), ref=source['range'])
    views = E.SubElement(root, q('sheetViews'))
    E.SubElement(views, q('sheetView'), workbookViewId='0', showGridLines=str(sheet.show_grid_lines))
    E.SubElement(root, q('sheetFormatPr'), defaultRowHeight=str(sheet.default_row_height/20))
    columns = E.SubElement(root, q('cols'))
    for index, info in sorted(sheet.colinfo_map.items()):
        E.SubElement(columns, q('col'), min=str(index+1), max=str(index+1), width=str(info.width/256), customWidth='1', hidden=str(info.hidden))
    data = E.SubElement(root, q('sheetData'))
    byaddress = {c['address']: c for c in source['cells']}
    for r in range(sheet.nrows):
        attrs = {'r': str(r+1)}
        info = sheet.rowinfo_map.get(r)
        if info:
            attrs.update(ht=str(info.height/20), customHeight='1', hidden=str(info.hidden))
        row = E.SubElement(data, q('row'), attrs)
        for c in range(sheet.row_len(r)):
            address = col(c+1)+str(r+1)
            node = E.SubElement(row, q('c'), r=address, s=str(sheet.cell_xf_index(r,c)))
            cell = byaddress.get(address)
            if not cell:
                continue
            if cell['formula']:
                E.SubElement(node, q('f')).text=cell['formula']
            if isinstance(cell['value'], (float,int)):
                E.SubElement(node, q('v')).text=str(cell['value'])
            elif cell['value'] is not None:
                node.set('t','inlineStr')
                E.SubElement(E.SubElement(node,q('is')),q('t')).text=str(cell['value'])
    merges = E.SubElement(root,q('mergeCells'), count=str(len(sheet.merged_cells)))
    for r1,r2,c1,c2 in sheet.merged_cells:
        E.SubElement(merges,q('mergeCell'),ref=f'{col(c1+1)}{r1+1}:{col(c2)}{r2}')
    E.SubElement(root,q('pageMargins'),left='0.25',right='0.25',top='0.5',bottom='0.5',header='0.2',footer='0.2')
    # Legacy print defaults are retained separately from the original column sizing.
    return {'xml':E.tostring(root,encoding='unicode'),'styles':E.tostring(styles,encoding='unicode'),'theme':None,'printNames':[]}


def build(args):
    samples=json.loads(Path(args.analysis).read_text(encoding='utf-8'))
    templates=json.loads(Path(args.templates).read_text(encoding='utf-8'))
    # Preserve populated scratch columns too; the actual salary sample has a
    # one-row calculation outside its named headers.
    for sample in samples:
        for original in sample['sheets']:
            template=next((t for t in templates if t['sampleFile']==sample['file'] and t['sheetName']==original['name']),None)
            if not template:
                continue
            by={c['address']:c for c in original['cells']}
            namecol='D' if template['group']=='comparison' else 'C'
            for cell in original['cells']:
                r=row_number(cell['address']);key=re.sub(r'\d+','',cell['address'])
                if r>template['headerRow'] and by.get(namecol+str(r),{}).get('value') and isinstance(by.get('A'+str(r),{}).get('value'),(float,int)) and not by.get('A'+str(r),{}).get('formula') and key not in [c['key'] for c in template['columns']]:
                    template['columns'].append({'key':key,'label':'Additional amount','numeric':True,'date':False,'formula':None})
            for column in template['columns']:
                if column['label'] in ['Additional amount','Remarks']:
                    observed=[c for c in original['cells'] if re.sub(r'\d+','',c['address'])==column['key'] and by.get(namecol+str(row_number(c['address'])),{}).get('value') and isinstance(by.get('A'+str(row_number(c['address'])),{}).get('value'),(float,int)) and not by.get('A'+str(row_number(c['address'])),{}).get('formula')]
                    column['numeric']=any(c['formula'] or isinstance(c['value'],(float,int)) for c in observed)
                    column['label']='Additional amount' if column['numeric'] else 'Remarks'
    Path(args.templates).write_text(json.dumps(templates,ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
    groups={}
    for sample in samples:
        active=[t for t in templates if t['sampleFile']==sample['file']]
        group=active[0]['group']
        file=Path(args.samples)/sample['file']
        entries={}
        if file.suffix=='.xlsx':
            archive=ZipFile(file)
            strings=[]
            if 'xl/sharedStrings.xml' in archive.namelist():
                for si in E.fromstring(archive.read('xl/sharedStrings.xml')):
                    strings.append(''.join(si.itertext()))
            workbook=E.fromstring(archive.read('xl/workbook.xml'))
            rels={r.get('Id'):r.get('Target').lstrip('/') for r in E.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
            for i,node in enumerate(workbook.find(q('sheets'))):
                target=rels[node.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
                if not target.startswith('xl/'):
                    target='xl/'+target
                entries[node.get('name')]={'xml':archive.read(target).decode('utf-8'),'printNames':[{'name':d.get('name'),'value':d.text} for d in workbook.findall('./'+q('definedNames')+'/'+q('definedName')) if d.get('localSheetId')==str(i) and d.get('name') in ['_xlnm.Print_Area','_xlnm.Print_Titles']]}
            styles=archive.read('xl/styles.xml').decode('utf-8')
            theme=archive.read('xl/theme/theme1.xml').decode('utf-8') if 'xl/theme/theme1.xml' in archive.namelist() else None
        else:
            entries[sample['sheets'][0]['name']]=legacy_parts(file,sample['sheets'][0])
            styles=entries[sample['sheets'][0]['name']]['styles']
            theme=None
            strings=[]
        layouts={}
        for original in sample['sheets']:
            source=entries[original['name']]
            template=next((t for t in active if t['sheetName']==original['name']),None)
            if not template:
                layouts[original['name']]={'emptyXml':source['xml'],'printNames':source['printNames']}
                continue
            root=E.fromstring(source['xml'])
            namespaces={uri:prefix for prefix,uri in re.findall(r'xmlns:([\w]+)="([^"]+)"',source['xml'])}
            def attributes(node,omit):
                out={}
                for key,value in node.attrib.items():
                    if key in omit:
                        continue
                    if key.startswith('{'):
                        uri,local=key[1:].split('}',1)
                        key=namespaces[uri]+':'+local
                    out[key]=value
                return out
            data=root.find(q('sheetData'))
            by={c['address']:c for c in original['cells']}
            namecol='D' if group=='comparison' else 'C'
            data_rows=sorted(row_number(c['address']) for c in original['cells'] if re.fullmatch(r'A\d+',c['address']) and isinstance(c['value'],(float,int)) and not c['formula'] and by.get(namecol+str(row_number(c['address'])),{}).get('value') and row_number(c['address'])>template['headerRow'])
            last=max(data_rows)
            headers=[];footers=[];patterns=[];pattern_ids={};body={}
            for row in data:
                r=int(row.get('r'))
                attrs=attributes(row,['r','spans'])
                styles_by_col={re.sub(r'\d+','',c.get('r')):attributes(c,['r','t']) for c in row}
                if template['headerRow']<r<=last:
                    pattern={'attrs':attrs,'cells':styles_by_col,'types':{re.sub(r'\d+','',c.get('r')):c.get('t','n') for c in row}}
                    signature=json.dumps(pattern,sort_keys=True)
                    if signature not in pattern_ids:
                        pattern_ids[signature]=len(patterns);patterns.append(pattern)
                    body[str(r)]=pattern_ids[signature]
                    continue
                cells=[]
                for cell in row:
                    address=cell.get('r');record=by.get(address,{})
                    v=record.get('value');f=record.get('formula')
                    attrs_cell=attributes(cell,['r','t'])
                    cells.append({'key':re.sub(r'\d+','',address),'attrs':attrs_cell,'value':None if r>last and isinstance(v,(float,int)) else v,'formula':f,'input':r>last and isinstance(v,(float,int)) and not f})
                entry={'row':r,'attrs':attrs,'cells':cells}
                (headers if r<=template['headerRow'] else footers).append(entry)
            prefix,suffix=re.split(r'<sheetData(?:\s[^>]*)?>',source['xml'],maxsplit=1)
            _,suffix=suffix.split('</sheetData>',1)
            prefix=re.sub(r'<selection\b[^>]*/>','<selection activeCell="A1" sqref="A1"/>',prefix)
            layouts[template['id']]={'prefix':prefix,'suffix':suffix,'headerRows':headers,'footerRows':footers,'patterns':patterns,'body':body,'lastDataRow':last,'lastRow':row_number(original['range'].split(':')[-1]),'lastColumn':re.sub(r'\d+','',original['range'].split(':')[-1]),'printNames':source['printNames']}
        groups[group]={'sourceFile':sample['file'],'sheetOrder':[next((t['id'] for t in active if t['sheetName']==s['name']),s['name']) for s in sample['sheets']],'styles':styles,'theme':theme,'layouts':layouts}
        print(group,len(layouts),'sheets; sanitized styles, headers, footers and print layout captured')
    Path(args.output).write_text(json.dumps(groups,ensure_ascii=False,separators=(',',':')),encoding='utf-8',newline='\n')
    fields={}
    for template in templates:
        layout=groups[template['group']]['layouts'][template['id']]
        fields[template['id']]=[]
        for row in layout['footerRows']:
            for cell in row['cells']:
                if not cell['input']:
                    continue
                label=next((c['value'].strip() for c in reversed(row['cells'][:row['cells'].index(cell)]) if isinstance(c['value'],str) and c['value'].strip()),None)
                label=label or next((c['label'] for c in template['columns'] if c['key']==cell['key']), 'Additional amount')
                if label=='Remarks':
                    label='Additional amount'
                fields[template['id']].append({'address':cell['key']+str(row['row']),'label':label,'identifier':cell['key']=='B'})
    Path(args.output).with_name('salary-sheet-footer.json').write_text(json.dumps(fields,ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
    Path(args.output).with_name('salary-sheet-source-rows.json').write_text(json.dumps({t['id']:groups[t['group']]['layouts'][t['id']]['lastDataRow'] for t in templates}),encoding='utf-8',newline='\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--samples',required=True)
    parser.add_argument('--analysis',required=True)
    parser.add_argument('--templates',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--vendor')
    args=parser.parse_args()
    if args.vendor:
        sys.path.insert(0,args.vendor)
    build(args)
